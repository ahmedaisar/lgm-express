"use strict";

const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.CMS_SOURCE = "json";
process.env.CMS_JSON_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lgm-hardening-")), "cms.json");
process.env.ALLOWED_ORIGINS = "https://frontend.example";
process.env.RATE_LIMIT_MAX = "1000";

const app = require("../api/index.js");

describe("http hardening middleware", () => {
  let server;
  let base;

  before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.on("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  it("adds a request id and security headers", async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("x-request-id"));
    assert.ok(response.headers.get("x-content-type-options"));
    assert.equal(response.headers.get("x-powered-by"), null);
  });

  it("preserves a well-formed supplied request id", async () => {
    const response = await fetch(`${base}/health`, { headers: { "X-Request-Id": "smoke:test-1" } });
    assert.equal(response.headers.get("x-request-id"), "smoke:test-1");
  });

  it("reflects allowlisted browser origins only", async () => {
    const allowed = await fetch(`${base}/health`, { headers: { Origin: "https://frontend.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://frontend.example");

    const blocked = await fetch(`${base}/health`, { headers: { Origin: "https://untrusted.example" } });
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  });

  it("exposes a readiness endpoint without touching portal login", async () => {
    const response = await fetch(`${base}/health/ready`);
    assert.ok([200, 503].includes(response.status));
    const body = await response.json();
    assert.ok(body.status === "ok" || body.status === "unready");
  });

  it("provides a machine-readable OpenAPI document", async () => {
    const response = await fetch(`${base}/openapi.json`);
    assert.equal(response.status, 200);
    const spec = await response.json();
    assert.equal(spec.openapi, "3.0.3");
    assert.ok(spec.paths["/search"]);
  });
});
