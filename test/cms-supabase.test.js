"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("../lib/cms/store");
const csv = require("../lib/cms/csv");
const db = require("../lib/cms/db");
const supa = require("../lib/cms/supabaseStore");

const SAVED_ENV = {};
for (const k of ["CMS_SOURCE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CMS_JSON_PATH"]) {
  SAVED_ENV[k] = process.env[k];
}
function restoreEnv() {
  for (const k of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
}

let dbPath;
beforeEach(() => {
  restoreEnv();
  delete process.env.CMS_SOURCE;
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmssupa-")), "cms.json");
  process.env.CMS_JSON_PATH = dbPath;
});

describe("supabase row mapping", () => {
  it("round-trips a full record through toRow/toRecord", () => {
    const rec = store.create(
      {
        name: "Sun Resort", description: "Beach", atoll: "Male", stars: 5,
        photos: ["https://example.com/a.jpg"], amenities: ["wifi"],
        website: "https://sun.example.com", portal_hotel_id: "11", portal_slug: "sun-resort",
        check_in_from: "14:00", pets_allowed: false, payment_methods: ["VISA"],
        fine_print: "Speedboat.",
      },
      dbPath
    );
    const back = supa.toRecord(supa.toRow(rec));
    assert.equal(back.id, rec.id);
    assert.equal(back.name, "Sun Resort");
    assert.equal(back.stars, 5);
    assert.deepEqual(back.photos, ["https://example.com/a.jpg"]);
    assert.equal(back.portal_hotel_id, "11");
    assert.equal(back.pets_allowed, false);
    assert.deepEqual(back.payment_methods, ["VISA"]);
  });

  it("normalizes sparse/nullish rows to safe defaults", () => {
    const back = supa.toRecord({ id: "x", name: "X", photos: null, stars: null });
    assert.deepEqual(back.photos, []);
    assert.deepEqual(back.amenities, []);
    assert.equal(back.stars, null);
    assert.equal(back.portal_hotel_id, null);
    assert.equal(back.pets_allowed, null);
    assert.ok(back.updated_at);
  });

  it("toRow whitelists columns (never leaks extra keys)", () => {
    const row = supa.toRow({ id: "x", name: "X", injected: "DROP TABLE", cms: { secret: 1 } });
    assert.ok(!("injected" in row));
    assert.ok(!("cms" in row));
    assert.deepEqual(Object.keys(row).sort(), [
      "age_restriction", "amenities", "atoll", "cancellation_prepayment", "check_in_from",
      "check_in_notes", "check_out_until", "child_policies", "cot_extra_bed_policies",
      "description", "fine_print", "id", "name", "payment_methods", "pets_allowed",
      "pets_notes", "photos", "portal_hotel_id", "portal_slug", "stars", "updated_at", "website",
    ]);
  });
});

describe("planImport parity", () => {
  const HEADER = "id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug";

  it("matches importCsv counts on mixed create/update/error input", () => {
    store.create({ name: "Keep Hotel", portal_hotel_id: "99" }, dbPath);
    const text = [
      HEADER,
      ",New Hotel,Desc,Atoll,4,https://example.com/n.jpg,pool,https://new.example,50,new-hotel",
      ",,,,,,,,,",
      ",Keep Updated,,,,,,,99,keep-hotel",
    ].join("\n");
    const plan = csv.planImport(text, store.list(dbPath));
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.errors.length, 1);
    assert.match(plan.errors[0].error, /name is required/);
    const res = csv.importCsv(text, dbPath);
    assert.equal(res.created, 1);
    assert.equal(res.updated, 1);
    assert.equal(res.errors.length, 1);
    assert.equal(store.get("new-hotel", dbPath).stars, 4);
  });

  it("a later row referencing a just-planned id plans an update", () => {
    const text = [HEADER, ",Foo Hotel,,,,,,,,", "foo-hotel,,Desc,,,,,,,"].join("\n");
    const plan = csv.planImport(text, []);
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.updates.length, 1);
    const res = csv.importCsv(text, dbPath);
    assert.equal(res.created, 1);
    assert.equal(res.updated, 1);
    assert.equal(store.get("foo-hotel", dbPath).description, "Desc");
  });

  it("reports csv line numbers on value errors", () => {
    const text = [HEADER, ",Bad Stars,,,9,,,,,"].join("\n");
    const plan = csv.planImport(text, []);
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.errors.length, 1);
    assert.equal(plan.errors[0].line, 2);
  });
});

describe("db router", () => {
  it("json mode delegates to the file store", async () => {
    const rec = await db.create({ name: "Router Hotel", portal_hotel_id: "7" }, dbPath);
    assert.equal(rec.id, "router-hotel");
    assert.equal((await db.get("router-hotel", dbPath)).name, "Router Hotel");
    assert.equal((await db.list(dbPath)).length, 1);
    const page = await db.query(dbPath, { page: 1, per_page: 10 });
    assert.equal(page.total, 1);
    const upd = await db.update("router-hotel", { description: "Hi" }, dbPath);
    assert.equal(upd.description, "Hi");
    assert.equal(await db.remove("router-hotel", dbPath), true);
    assert.equal((await db.list(dbPath)).length, 0);
  });

  it("supabase mode without creds falls back to json", async () => {
    process.env.CMS_SOURCE = "supabase";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(db.useSupabase(), false);
    const rec = await db.create({ name: "Fallback Hotel" }, dbPath);
    assert.equal(rec.id, "fallback-hotel");
    assert.equal((await db.list(dbPath)).length, 1);
  });

  it("supabaseStore reports unconfigured without creds", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(supa.configured(), false);
  });
});
