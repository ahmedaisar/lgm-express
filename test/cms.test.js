"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("../lib/cms/store");
const csv = require("../lib/cms/csv");
const merge = require("../lib/cms/merge");

let dbPath;
beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cms-")), "cms.json");
});

describe("cms store", () => {
  it("starts empty when the file is missing", () => {
    assert.deepEqual(store.list(dbPath), []);
  });

  it("creates with slugified id, defaults, and timestamp", () => {
    const rec = store.create({ name: "Sun Resort", portal_hotel_id: "11" }, dbPath);
    assert.equal(rec.id, "sun-resort");
    assert.deepEqual(rec.photos, []);
    assert.equal(rec.portal_slug, null);
    assert.ok(rec.updated_at);
    assert.deepEqual(store.get("sun-resort", dbPath), rec);
  });

  it("dedupes ids and handles unicode names", () => {
    const a = store.create({ name: "Café Resort" }, dbPath);
    const b = store.create({ name: "Cafe Resort!" }, dbPath);
    assert.equal(a.id, "cafe-resort");
    assert.equal(b.id, "cafe-resort-2");
  });

  it("update keeps id immutable and bumps updated_at", () => {
    const rec = store.create({ name: "Sun Resort" }, dbPath);
    const updated = store.update(rec.id, { id: "hacked", description: "Nice", stars: "5" }, dbPath);
    assert.equal(updated.id, rec.id);
    assert.equal(updated.description, "Nice");
    assert.equal(updated.stars, 5);
    assert.ok(updated.updated_at >= rec.updated_at);
  });

  it("validates input", () => {
    assert.throws(() => store.create({}, dbPath), /name is required/);
    assert.throws(() => store.create({ name: "X", stars: 9 }, dbPath), /stars must be/);
    assert.throws(() => store.create({ name: "X", portal_hotel_id: "abc" }, dbPath), /must be numeric/);
  });

  it("removes records", () => {
    const rec = store.create({ name: "Sun Resort" }, dbPath);
    assert.equal(store.remove(rec.id, dbPath), true);
    assert.equal(store.remove(rec.id, dbPath), false);
    assert.deepEqual(store.list(dbPath), []);
  });

  it("persists across instances", () => {
    store.create({ name: "Sun Resort" }, dbPath);
    assert.equal(store.list(dbPath).length, 1);
  });
});

describe("csv import/export", () => {
  it("imports, upserts by id then portal_hotel_id, reports errors", () => {
    const text2 = [
      "id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug",
      ",Sun Resort,Beach fun,Male Atoll,5,https://a.jpg|https://b.jpg,wifi|spa,https://sun.example,11,sun-resort",
      ",,,,,,,,,",
    ].join("\n");
    const first = csv.importCsv(text2, dbPath);
    assert.equal(first.created, 1);
    assert.equal(first.updated, 0);
    assert.equal(first.errors.length, 1);
    assert.match(first.errors[0].error, /name is required/);

    const rec = store.list(dbPath)[0];
    assert.equal(rec.id, "sun-resort");
    assert.deepEqual(rec.photos, ["https://a.jpg", "https://b.jpg"]);
    assert.deepEqual(rec.amenities, ["wifi", "spa"]);

    // upsert by portal_hotel_id (no id given)
    const second = csv.importCsv(
      "id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug\n" +
        ",Sun Resort Updated,,,,,,,11,sun-resort\n",
      dbPath
    );
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(store.get("sun-resort", dbPath).description, "Beach fun");
  });

  it("exports a round-trippable csv", () => {
    store.create(
      { name: "Sun Resort", atoll: "Male", stars: 5, photos: ["https://a.jpg"], portal_hotel_id: "11" },
      dbPath
    );
    const out = csv.toCsv(store.list(dbPath));
    assert.ok(out.startsWith("id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug"));
    const back = csv.importCsv(out, dbPath);
    assert.equal(back.updated, 1);
    assert.equal(back.created, 0);
  });
});

describe("cms merge", () => {
  it("attaches public view by hotel_id, null when unmapped", () => {
    const rec = store.create({ name: "Sun Resort", portal_hotel_id: "11", photos: ["https://a.jpg"] }, dbPath);
    const rows = merge.enrichSearchRows(
      [{ hotel_id: "11", hotel_name: "Sun Resort" }, { hotel_id: 22, hotel_name: "Other" }],
      store.list(dbPath)
    );
    assert.equal(rows[0].cms.name, "Sun Resort");
    assert.deepEqual(rows[0].cms.photos, ["https://a.jpg"]);
    assert.ok(!("portal_hotel_id" in rows[0].cms));
    assert.equal(rows[1].cms, null);
    assert.equal(
      merge.enrichQuote({ hotel_id: "11", rooms: [] }, store.list(dbPath)).cms.id,
      rec.id
    );
  });
});

describe("policy fields", () => {
  it("stores house rules, policies, pets, payments with coercion", () => {
    const rec = store.create(
      {
        name: "Policy Hotel",
        check_in_from: "14:00",
        check_in_notes: "Show ID",
        check_out_until: "12:00",
        cancellation_prepayment: "Varies by rate",
        child_policies: "Kids welcome",
        cot_extra_bed_policies: "Cot free",
        age_restriction: "No age requirement",
        pets_allowed: "false",
        pets_notes: "Except guide dogs",
        payment_methods: "VISA|MASTER|CASH",
        fine_print: "Shared seaplane.",
      },
      dbPath
    );
    assert.equal(rec.check_in_from, "14:00");
    assert.equal(rec.pets_allowed, false);
    assert.deepEqual(rec.payment_methods, ["VISA", "MASTER", "CASH"]);
    assert.equal(rec.fine_print, "Shared seaplane.");
    assert.throws(
      () => store.create({ name: "Bad", pets_allowed: "maybe" }, dbPath),
      /true\/false/
    );
  });

  it("merge exposes policy fields with safe defaults", () => {
    store.create({ name: "Bare Hotel", portal_hotel_id: "99" }, dbPath);
    const [row] = merge.enrichSearchRows(
      [{ hotel_id: "99", hotel_name: "Bare Hotel" }],
      store.list(dbPath)
    );
    assert.equal(row.cms.check_in_from, "");
    assert.equal(row.cms.pets_allowed, null);
    assert.deepEqual(row.cms.payment_methods, []);
    assert.equal(row.cms.fine_print, "");
  });

  it("csv round-trips policy fields including pets boolean", () => {
    store.create(
      {
        name: "Policy Hotel",
        check_in_from: "14:00",
        pets_allowed: false,
        payment_methods: ["VISA", "CASH"],
        fine_print: "Line one.",
      },
      dbPath
    );
    const out = csv.toCsv(store.list(dbPath));
    assert.ok(out.includes("check_in_from"));
    assert.ok(out.includes("pets_allowed"));
    const back = csv.importCsv(out, dbPath);
    assert.equal(back.updated, 1);
    const rec = store.list(dbPath)[0];
    assert.equal(rec.check_in_from, "14:00");
    assert.equal(rec.pets_allowed, false);
    assert.deepEqual(rec.payment_methods, ["VISA", "CASH"]);
  });
});
