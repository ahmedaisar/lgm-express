"use strict";

// JSON file store for CMS Hotels. data/cms.json is the committed source of
// truth; writes are atomic (tmp file + rename). No dependencies.

const fs = require("fs");
const path = require("path");
const { HttpError } = require("../api/common");

function defaultPath() {
  return path.resolve(process.env.CMS_JSON_PATH || "data/cms.json");
}

function loadAll(dbPath = defaultPath()) {
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    if (!Array.isArray(data)) throw new Error("not a list");
    return data;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new HttpError(500, `CMS store unreadable: ${err.message}`);
  }
}

function saveAll(records, dbPath = defaultPath()) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, dbPath);
}

function slugify(name, existing) {
  const base =
    String(name || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "hotel";
  let id = base;
  let n = 2;
  while (existing.has(id)) id = `${base}-${n++}`;
  return id;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? "")
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);
}

function nullIfEmpty(value) {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

function toBooleanOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (s === "") return null;
  if (["true", "yes", "y", "1", "allowed"].includes(s)) return true;
  if (["false", "no", "n", "0", "not allowed"].includes(s)) return false;
  throw new HttpError(400, `expected true/false, got ${JSON.stringify(value)}`);
}

// Coerce + validate a hotel body. Throws HttpError(400) on bad input.
// In strict mode (create) name is required; update merges over the stored record first.
function normalizeRecord(input, { partial = false } = {}) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "hotel body must be a JSON object");
  }
  const out = {};
  if ("name" in input || !partial) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new HttpError(400, "name is required");
    out.name = name;
  }
  if ("description" in input) out.description = String(input.description ?? "");
  if ("atoll" in input) out.atoll = String(input.atoll ?? "");
  if ("stars" in input) {
    const raw = input.stars;
    if (raw === null || raw === "" || raw === undefined) {
      out.stars = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 7) {
        throw new HttpError(400, `stars must be 0-7 or null, got ${JSON.stringify(raw)}`);
      }
      out.stars = n;
    }
  }
  if ("photos" in input) out.photos = splitList(input.photos);
  if ("amenities" in input) out.amenities = splitList(input.amenities);
  if ("website" in input) out.website = String(input.website ?? "").trim();
  if ("portal_hotel_id" in input) {
    const v = nullIfEmpty(input.portal_hotel_id);
    if (v !== null && !/^\d+$/.test(v)) {
      throw new HttpError(400, `portal_hotel_id must be numeric, got ${JSON.stringify(input.portal_hotel_id)}`);
    }
    out.portal_hotel_id = v;
  }
  if ("portal_slug" in input) out.portal_slug = nullIfEmpty(input.portal_slug);
  // House rules & policies (all optional free text, kept as-is for display).
  for (const field of [
    "check_in_from",
    "check_in_notes",
    "check_out_until",
    "cancellation_prepayment",
    "child_policies",
    "cot_extra_bed_policies",
    "age_restriction",
    "pets_notes",
    "fine_print",
  ]) {
    if (field in input) out[field] = String(input[field] ?? "");
  }
  if ("pets_allowed" in input) out.pets_allowed = toBooleanOrNull(input.pets_allowed);
  if ("payment_methods" in input) out.payment_methods = splitList(input.payment_methods);
  return out;
}

function list(dbPath) {
  return loadAll(dbPath);
}

function get(id, dbPath) {
  return loadAll(dbPath).find((r) => r.id === id) || null;
}

function create(input, dbPath) {
  const records = loadAll(dbPath);
  const data = normalizeRecord(input);
  const now = new Date().toISOString();
  const rec = {
    id: slugify(data.name, new Set(records.map((r) => r.id))),
    description: "",
    atoll: "",
    stars: null,
    photos: [],
    amenities: [],
    website: "",
    portal_hotel_id: null,
    portal_slug: null,
    check_in_from: "",
    check_in_notes: "",
    check_out_until: "",
    cancellation_prepayment: "",
    child_policies: "",
    cot_extra_bed_policies: "",
    age_restriction: "",
    pets_allowed: null,
    pets_notes: "",
    payment_methods: [],
    fine_print: "",
    ...data,
    updated_at: now,
  };
  records.push(rec);
  saveAll(records, dbPath);
  return rec;
}

function update(id, patch, dbPath) {
  const records = loadAll(dbPath);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const { id: _ignored, ...rest } = patch || {};
  const data = normalizeRecord(rest, { partial: true });
  records[idx] = { ...records[idx], ...data, id, updated_at: new Date().toISOString() };
  saveAll(records, dbPath);
  return records[idx];
}

function remove(id, dbPath) {
  const records = loadAll(dbPath);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  saveAll(records, dbPath);
  return true;
}

module.exports = {
  defaultPath,
  loadAll,
  saveAll,
  list,
  get,
  create,
  update,
  remove,
  normalizeRecord,
};
