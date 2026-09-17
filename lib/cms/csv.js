"use strict";

// CSV import/export for CMS Hotels. Columns:
// id,name,description,atoll,stars,photos,amenities,website,portal_hotel_id,portal_slug
// photos/amenities are |-separated URL/tag lists. Upsert rule: match `id` when
// given, else `portal_hotel_id`, else create.

const Papa = require("papaparse");
const { HttpError } = require("../api/common");
const store = require("./store");

const COLUMNS = [
  "id",
  "name",
  "description",
  "atoll",
  "stars",
  "photos",
  "amenities",
  "website",
  "portal_hotel_id",
  "portal_slug",
  "check_in_from",
  "check_in_notes",
  "check_out_until",
  "cancellation_prepayment",
  "child_policies",
  "cot_extra_bed_policies",
  "age_restriction",
  "pets_allowed",
  "pets_notes",
  "payment_methods",
  "fine_print",
];

function parseCsv(text) {
  const parsed = Papa.parse(String(text || ""), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    const first = parsed.errors[0];
    throw new HttpError(400, `CSV parse error row ${first.row}: ${first.message}`);
  }
  return parsed.data;
}

function rowToInput(row) {
  const get = (k) => (row[k] === undefined || row[k] === null ? "" : String(row[k]));
  const id = get("id").trim() || null;
  const input = {
    name: get("name"),
    description: get("description"),
    atoll: get("atoll"),
    stars: get("stars"),
    photos: get("photos"),
    amenities: get("amenities"),
    website: get("website"),
    portal_hotel_id: get("portal_hotel_id"),
    portal_slug: get("portal_slug"),
    check_in_from: get("check_in_from"),
    check_in_notes: get("check_in_notes"),
    check_out_until: get("check_out_until"),
    cancellation_prepayment: get("cancellation_prepayment"),
    child_policies: get("child_policies"),
    cot_extra_bed_policies: get("cot_extra_bed_policies"),
    age_restriction: get("age_restriction"),
    pets_allowed: get("pets_allowed"),
    pets_notes: get("pets_notes"),
    payment_methods: get("payment_methods"),
    fine_print: get("fine_print"),
  };
  return { id, input };
}

// Blank CSV cells never wipe stored values on update (use PUT to clear a
// field explicitly); on create they fall back to defaults.
function nonBlank(input) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== ""));
}

function importCsv(text, dbPath) {
  const rows = parseCsv(text);
  let created = 0;
  let updated = 0;
  const errors = [];
  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    try {
      const { id, input } = rowToInput(row);
      if (id) {
        const existing = store.get(id, dbPath);
        if (existing) {
          store.update(id, nonBlank(input), dbPath);
          updated += 1;
          return;
        }
      }
      if (input.portal_hotel_id.trim() !== "") {
        const match = store
          .list(dbPath)
          .find((r) => String(r.portal_hotel_id || "") === input.portal_hotel_id.trim());
        if (match) {
          store.update(match.id, nonBlank(input), dbPath);
          updated += 1;
          return;
        }
      }
      if (input.name.trim() === "") {
        throw new HttpError(400, `line ${line}: name is required`);
      }
      store.create(input, dbPath);
      created += 1;
    } catch (err) {
      errors.push({ line, error: err.message || String(err) });
    }
  });
  return { created, updated, errors };
}

function cell(value) {
  if (value === null || value === undefined || value === false) return value === false ? "false" : "";
  if (value === true) return "true";
  if (Array.isArray(value)) return value.join("|");
  if (typeof value === "number") return String(value);
  return String(value);
}

function toCsv(records) {
  return Papa.unparse(
    records.map((r) => ({
      id: r.id || "",
      name: r.name || "",
      description: r.description || "",
      atoll: r.atoll || "",
      stars: r.stars === null || r.stars === undefined ? "" : String(r.stars),
      photos: (r.photos || []).join("|"),
      amenities: (r.amenities || []).join("|"),
      website: r.website || "",
      portal_hotel_id: r.portal_hotel_id || "",
      portal_slug: r.portal_slug || "",
      check_in_from: r.check_in_from || "",
      check_in_notes: r.check_in_notes || "",
      check_out_until: r.check_out_until || "",
      cancellation_prepayment: r.cancellation_prepayment || "",
      child_policies: r.child_policies || "",
      cot_extra_bed_policies: r.cot_extra_bed_policies || "",
      age_restriction: r.age_restriction || "",
      pets_allowed: cell(r.pets_allowed),
      pets_notes: r.pets_notes || "",
      payment_methods: (r.payment_methods || []).join("|"),
      fine_print: r.fine_print || "",
    })),
    { columns: COLUMNS }
  );
}

module.exports = { COLUMNS, parseCsv, importCsv, toCsv };
