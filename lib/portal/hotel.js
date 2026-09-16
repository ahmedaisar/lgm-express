"use strict";

const cheerio = require("cheerio");
const log = require("../log");
const { normalizeAvailability } = require("./search");

const HOTEL_PAGE_PATH = (slug) => `/hotel/${slug}/`;
const SKELETON_PATH = (slug) => `/hotel/book/load-hotel-data/${slug}/`;
const ROOM_LIMIT = 100;
const CURRENCY_ID_USD = "2"; // portal-internal id for USD (verified live)
const DEFAULT_GUESTS = "ST";

class HotelNotFound extends Error {}

function commaAges(adults, childAges) {
  return [...Array(adults).fill(25), ...((childAges || []).map(Number))].join(",");
}

function dashAges(adults, childAges) {
  return [...Array(adults).fill(25), ...((childAges || []).map(Number))].join("-");
}

function jsVar(html, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(html || "");
  return m ? m[1] : "";
}

function parseHotelPage(html, slug) {
  const $ = cheerio.load(html || "");
  return {
    hotel_id: jsVar(html, "hotel_id"),
    supplier_company_id: jsVar(html, "supplier_company_id"),
    room_ajax_url: jsVar(html, "room_ajax_url") || SKELETON_PATH(slug),
    csrf_token: $('input[name="csrfmiddlewaretoken"]').first().attr("value") || "",
    hotel_name: $("h1").first().text().trim() || slug,
  };
}

function parseCancellation(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function mealCode(title) {
  const s = String(title || "").split("(")[0].trim();
  return s || String(title || "").trim();
}

function featuresOf($, $room) {
  const box = $room.find(".room-features").first();
  if (!box.length) return [];
  const items = box
    .find("li")
    .toArray()
    .map((li) => $(li).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (items.length) return items;
  const text = box.text().replace(/\s+/g, " ").trim();
  return text ? [text] : [];
}

function parseHotelTemplate(html) {
  const $ = cheerio.load(html || "");
  const rooms = [];
  $('div[data-role="room"]').each((_, roomEl) => {
    const $room = $(roomEl);
    const roomName = $room.find(".room-title").first().text().trim();
    const occupancy = $room.find(".room-occupancy-data").first().text().trim();
    const availability = normalizeAvailability(
      String($room.find("[data-allotments-status]").first().attr("data-allotments-status") || "")
    );
    const features = featuresOf($, $room);
    const calc = String($room.attr("data-calculation-source") || "").trim() || null;
    const policies = $room
      .find(".cancellation-policies-json")
      .toArray()
      .map((el) => parseCancellation($(el).text()));
    const policy = policies.length === 1 ? policies[0] : policies.length ? policies : null;

    let currentMeal = "";
    let priced = 0;
    $room.find(".hotel-book-ajax__meal-title, button.select-room-and-meal").each((_, el) => {
      const $el = $(el);
      if ($el.hasClass("hotel-book-ajax__meal-title")) {
        currentMeal = mealCode($el.text());
        return;
      }
      let price = parseFloat(String($el.attr("data-price-for-view") || "").replace(/,/g, "").replace(/ /g, ""));
      if (!Number.isFinite(price)) price = null;
      rooms.push({
        room_name: roomName,
        meal_plan: currentMeal,
        net_price: price,
        currency: String($el.attr("data-currency-for-view") || "USD"),
        occupancy,
        availability,
        cancellation_policy: policy,
        room_features: features,
        calculation_method: calc,
      });
      priced += 1;
    });
    if (!priced) {
      log.warn("Room %j has no priced meal options", roomName);
      rooms.push({
        room_name: roomName,
        meal_plan: "",
        net_price: null,
        currency: "USD",
        occupancy,
        availability,
        cancellation_policy: policy,
        room_features: features,
        calculation_method: calc,
      });
    }
  });

  const transfers = [];
  $("div.select-transfer").each((_, t) => {
    const $t = $(t);
    const inputs = {};
    $t.find("input[name]").each((_, inp) => {
      inputs[$(inp).attr("name")] = $(inp).attr("value") || "";
    });
    let price = parseFloat(
      String($t.attr("data-price-for-view") || inputs.transfer_price || "").replace(/,/g, "").replace(/ /g, "")
    );
    if (!Number.isFinite(price)) return;
    const uid = String(inputs.transfer_uid || "");
    const direction = uid.includes("|")
      ? uid.split("|").slice(-1)[0]
      : `${inputs.transfer_from || ""} -> ${inputs.transfer_to || ""}`;
    transfers.push({
      vehicle_type: String(inputs.transfer_vehicle || ""),
      direction,
      pax: String(inputs.transfer_payment_type || ""),
      net_price: price,
      currency: String($t.attr("data-currency-for-view") || inputs.transfer_price_currency || "USD"),
    });
  });
  return { rooms, transfers };
}

async function assertOk(res, what) {
  if (res.status >= 400) throw new Error(`${what} failed: HTTP ${res.status}`);
}

async function getHotelQuote(session, { slug, dateStart, dateEnd, adults, childs, childAges, nationalityId, rateCode, guests = DEFAULT_GUESTS }) {
  const pageQuery = new URLSearchParams({
    search_type: "",
    travellers_ages: dashAges(adults, childAges),
    adults: String(adults),
    childs: String(childs),
    date_start: dateStart,
    date_end: dateEnd,
    currency: "USD",
    rate_code: rateCode,
    guests,
    nationality: nationalityId,
  });
  const pagePath = HOTEL_PAGE_PATH(slug) + "?" + pageQuery.toString();
  const pageRes = await session.request("GET", pagePath, {
    headers: { Referer: session.baseUrl.replace(/\/+$/, "") + "/" },
  });
  if (pageRes.status === 404) {
    throw new HotelNotFound(
      `Hotel ${JSON.stringify(slug)} not found — pass hotel_slug from /search (numeric ids have no portal route)`
    );
  }
  await assertOk(pageRes, "Hotel page");
  const ctx = parseHotelPage(await pageRes.text(), slug);
  if (!ctx.hotel_id || !ctx.supplier_company_id) {
    throw new HotelNotFound(`Hotel page for ${JSON.stringify(slug)} has no booking context`);
  }
  if (ctx.csrf_token) session.csrfToken = ctx.csrf_token;

  const body = new URLSearchParams({
    csrfmiddlewaretoken: ctx.csrf_token,
    supplier_company_id: ctx.supplier_company_id,
    hotel_id: ctx.hotel_id,
    date_start: dateStart,
    date_end: dateEnd,
    rate_code_code: rateCode,
    calc_source: "",
    currency_id: CURRENCY_ID_USD,
    travellers_ages: commaAges(adults, childAges),
    with_transfers: "1",
    room_limit: String(ROOM_LIMIT),
    nationality: nationalityId,
    guests,
    room_id: "",
    hotel_supplier_id: "",
    extra_bed: "",
  });
  const skelRes = await session.request("POST", ctx.room_ajax_url, {
    data: body,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: session.baseUrl.replace(/\/+$/, "") + pagePath,
    },
  });
  await assertOk(skelRes, "Hotel skeleton");
  let template;
  try {
    template = JSON.parse(await skelRes.text()).success.template;
  } catch (err) {
    throw new Error(`Unexpected skeleton response for ${JSON.stringify(slug)}: ${err.message}`);
  }

  const { rooms, transfers } = parseHotelTemplate(template);
  log.debug("quote %s: %s rows, %s transfers", slug, rooms.length, transfers.length);
  if (!rooms) log.info("Hotel %s returned zero rooms (no_results)", slug);
  return {
    hotel_name: ctx.hotel_name,
    hotel_id: ctx.hotel_id,
    hotel_slug: slug,
    rooms,
    transfers,
    availability: rooms.length ? "ok" : "no_results",
  };
}

module.exports = {
  HotelNotFound,
  commaAges,
  dashAges,
  parseHotelPage,
  parseHotelTemplate,
  getHotelQuote,
};
