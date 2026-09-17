"use strict";

// CMS merge: attach CMS Hotel content to portal results by numeric hotel id.
// Link internals (portal_hotel_id/portal_slug) stay out of the public view.

function publicView(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    description: rec.description || "",
    atoll: rec.atoll || "",
    stars: rec.stars ?? null,
    photos: rec.photos || [],
    amenities: rec.amenities || [],
    website: rec.website || "",
    check_in_from: rec.check_in_from || "",
    check_in_notes: rec.check_in_notes || "",
    check_out_until: rec.check_out_until || "",
    cancellation_prepayment: rec.cancellation_prepayment || "",
    child_policies: rec.child_policies || "",
    cot_extra_bed_policies: rec.cot_extra_bed_policies || "",
    age_restriction: rec.age_restriction || "",
    pets_allowed: rec.pets_allowed ?? null,
    pets_notes: rec.pets_notes || "",
    payment_methods: rec.payment_methods || [],
    fine_print: rec.fine_print || "",
  };
}

function indexByPortalId(records) {
  const map = new Map();
  for (const rec of records || []) {
    if (rec.portal_hotel_id !== null && rec.portal_hotel_id !== undefined && rec.portal_hotel_id !== "") {
      map.set(String(rec.portal_hotel_id), rec);
    }
  }
  return map;
}

function enrichSearchRows(rows, records) {
  const byId = indexByPortalId(records);
  return (rows || []).map((row) => ({
    ...row,
    cms: publicView(byId.get(String(row.hotel_id ?? "")) || null),
  }));
}

function enrichQuote(quote, records) {
  const byId = indexByPortalId(records);
  return {
    ...quote,
    cms: publicView(byId.get(String(quote.hotel_id ?? "")) || null),
  };
}

module.exports = { publicView, indexByPortalId, enrichSearchRows, enrichQuote };
