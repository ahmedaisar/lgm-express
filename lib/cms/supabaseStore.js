"use strict";

const store = require("./store");
const db = require("./db");

function asPromise(value) {
  return Promise.resolve(value);
}

function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function toRecord(row) {
  const safe = row && typeof row === "object" ? row : {};
  return {
    id: String(safe.id || ""),
    name: String(safe.name || ""),
    description: String(safe.description || ""),
    atoll: String(safe.atoll || ""),
    stars: safe.stars === null || safe.stars === undefined ? null : Number(safe.stars),
    photos: Array.isArray(safe.photos) ? safe.photos : [],
    amenities: Array.isArray(safe.amenities) ? safe.amenities : [],
    website: String(safe.website || ""),
    portal_hotel_id: safe.portal_hotel_id === null || safe.portal_hotel_id === undefined ? null : String(safe.portal_hotel_id),
    portal_slug: safe.portal_slug === null || safe.portal_slug === undefined ? null : String(safe.portal_slug),
    check_in_from: String(safe.check_in_from || ""),
    check_in_notes: String(safe.check_in_notes || ""),
    check_out_until: String(safe.check_out_until || ""),
    cancellation_prepayment: String(safe.cancellation_prepayment || ""),
    child_policies: String(safe.child_policies || ""),
    cot_extra_bed_policies: String(safe.cot_extra_bed_policies || ""),
    age_restriction: String(safe.age_restriction || ""),
    pets_allowed: typeof safe.pets_allowed === "boolean" ? safe.pets_allowed : null,
    pets_notes: String(safe.pets_notes || ""),
    payment_methods: Array.isArray(safe.payment_methods) ? safe.payment_methods : [],
    fine_print: String(safe.fine_print || ""),
    updated_at: safe.updated_at || new Date().toISOString(),
  };
}

function toRow(record) {
  const rec = toRecord(record);
  const fields = [
    "id", "name", "description", "atoll", "stars", "photos", "amenities", "website",
    "portal_hotel_id", "portal_slug", "check_in_from", "check_in_notes", "check_out_until",
    "cancellation_prepayment", "child_policies", "cot_extra_bed_policies", "age_restriction",
    "pets_allowed", "pets_notes", "payment_methods", "fine_print", "updated_at",
  ];
  return Object.fromEntries(fields.map((key) => [key, rec[key]]));
}

module.exports = {
  configured,
  toRecord,
  toRow,
  // The current router intentionally uses JSON fallback until a configured
  // Supabase backend is wired with an explicit schema and migration.
  list: (...args) => asPromise(store.list(...args)),
  get: (...args) => asPromise(store.get(...args)),
  create: (...args) => asPromise(store.create(...args)),
  update: (...args) => asPromise(store.update(...args)),
  remove: (...args) => asPromise(store.remove(...args)),
  query: (...args) => asPromise(db.query(...args)),
};
