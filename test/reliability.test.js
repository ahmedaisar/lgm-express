"use strict";

const assert = require("node:assert/strict");
const { describe, it, before } = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { TtlCache } = require("../lib/api/cache");
const { Semaphore } = require("../lib/portal/session");

describe("ttl cache", () => {
  it("stableKey is order-independent", () => {
    assert.equal(
      TtlCache.stableKey({ b: 1, a: "x" }),
      TtlCache.stableKey({ a: "x", b: 1 })
    );
  });

  it("expires entries after ttl", async () => {
    const c = new TtlCache({ ttlMs: 20, maxEntries: 10 });
    c.set("k", { v: 1 });
    assert.deepEqual(c.get("k"), { v: 1 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(c.get("k"), undefined);
  });

  it("evicts oldest past maxEntries", () => {
    const c = new TtlCache({ ttlMs: 60000, maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    assert.equal(c.get("a"), undefined);
    assert.equal(c.get("c"), 3);
    assert.equal(c.size, 2);
  });
});

describe("semaphore backpressure", () => {
  it("rejects with 503 + Retry-After when the queue is full", async () => {
    const s = new Semaphore(1, 1);
    await s.acquire(); // holds the single slot
    const waiting = s.acquire(); // occupies the one queue slot
    await assert.rejects(s.acquire(), (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.headers["Retry-After"], "5");
      return true;
    });
    s.release();
    await waiting;
    s.release();
  });
});

describe("cms query helper", () => {
  const store = require("../lib/cms/store");
  let dbPath;
  before(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmsq-")), "cms.json");
    store.create({ name: "Sun Resort", atoll: "Male", portal_hotel_id: "11" }, dbPath);
    store.create({ name: "Palm Island", atoll: "Baa", portal_hotel_id: "22" }, dbPath);
    store.create({ name: "Sun Lagoon", atoll: "Male", portal_hotel_id: "33" }, dbPath);
  });

  it("returns the filtered array when no pagination params", () => {
    const all = store.query(store.list(dbPath), {});
    assert.equal(all.length, 3);
    const sun = store.query(store.list(dbPath), { q: "sun" });
    assert.equal(sun.length, 2);
  });

  it("returns an envelope with ?page=", () => {
    const page = store.query(store.list(dbPath), { page: 1, per_page: 2 });
    assert.equal(page.results.length, 2);
    assert.equal(page.total, 3);
    assert.equal(page.page, 1);
    assert.equal(page.per_page, 2);
    const last = store.query(store.list(dbPath), { page: 2, per_page: 2 });
    assert.equal(last.results.length, 1);
  });
});

describe("reliability http surface", () => {
  let app;
  let server;
  let base;
  let adminToken;

  before(async () => {
    process.env.API_KEYS = "rel-key";
    process.env.RATE_LIMIT_MAX = "1000";
    process.env.SEARCH_CACHE_TTL_MS = "0";
    // Hermetic CMS backend: ambient .env may run supabase mode, which would
    // send these tests to real network with bogus creds and stall.
    process.env.CMS_SOURCE = "json";
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.SUPABASE_JWT_SECRET = "reliability-test-secret";
    process.env.CMS_JSON_PATH = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "cmshttp-")),
      "cms.json"
    );
    // Supabase-admin guard with stubbed identity (no network): every Bearer
    // token maps to an active admin.
    const guard = require("../lib/auth/supabaseAdmin");
    guard._overrides.verify = () => ({ sub: "admin-1" });
    guard._overrides.fetchProfile = async () => ({
      id: "admin-1", email: "owner@example.com", role: "admin", status: "active",
    });
    adminToken = "stubbed-admin-token";
    app = require("../api/index.js");
    server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const name of ["Alpha Hotel", "Beta Hotel", "Gamma Hotel"]) {
      const r = await fetch(`${base}/admin/hotels`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name }),
      });
      assert.equal(r.status, 201);
    }
    // node:test has no global after(); close via process hook below.
  });

  it("serves /openapi.json with the documented paths", async () => {
    const res = await fetch(`${base}/openapi.json`);
    assert.equal(res.status, 200);
    const spec = await res.json();
    assert.equal(spec.openapi, "3.0.3");
    for (const p of ["/health", "/health/ready", "/search", "/hotels/{hotelId}", "/admin/hotels"]) {
      assert.ok(spec.paths[p], `missing path ${p}`);
    }
  });

  it("tags responses with X-Request-Id", async () => {
    const res = await fetch(`${base}/health`);
    assert.ok(res.headers.get("x-request-id"), "missing X-Request-Id");
  });

  it("reports ready without touching the portal", async () => {
    const res = await fetch(`${base}/health/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.cms_hotels, 3);
    assert.ok(body.mapping_countries > 200);
  });

  it("rate-limit headers are present on guarded routes", async () => {
    // Authenticated (shared key) so the request reaches the limiter; the
    // limiter runs after auth by design (rejected callers consume no quota).
    const res = await fetch(
      `${base}/search?date_start=2026-10-01&date_end=2026-10-05&adults=2&nationality=Atlantis`,
      { headers: { "x-api-key": "rel-key" } }
    );
    assert.equal(res.status, 422); // authed, limiter ran, validation rejected
    assert.ok(res.headers.get("ratelimit-limit"), "missing RateLimit-Limit header");
  });

  it("agent Bearer passes rates auth without a shared key", async () => {
    const res = await fetch(
      `${base}/search?date_start=2026-10-01&date_end=2026-10-05&adults=2&nationality=Atlantis`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assert.equal(res.status, 422); // authed as agent (stubbed), validation rejected
  });

  it("admin list stays an array by default, envelopes with ?page=", async () => {
    const h = { Authorization: `Bearer ${adminToken}` };
    const all = await (await fetch(`${base}/admin/hotels`, { headers: h })).json();
    assert.ok(Array.isArray(all));
    assert.equal(all.length, 3);
    const page = await (await fetch(`${base}/admin/hotels?page=1&per_page=2`, { headers: h })).json();
    assert.equal(page.results.length, 2);
    assert.equal(page.total, 3);
    const q = await (await fetch(`${base}/admin/hotels?q=beta`, { headers: h })).json();
    assert.equal(q.length, 1);
    assert.equal(q[0].name, "Beta Hotel");
    server.close();
  });
});
