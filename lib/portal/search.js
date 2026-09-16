"use strict";

const cheerio = require("cheerio");
const log = require("../log");

const SEARCH_PATH = "/hotels-search-hotel/";
const SEARCH_REFERER_PATH = "/hotel-search/";
const MAX_PARTS = 50;

const DEST_COUNTRY_ID = "228";
const DEST_LABEL = "Maldives";
const DEFAULT_RATE_CODE = "7ZV5P";
const DEFAULT_GUESTS = "ST";
const ADULT_AGE = 25;

const STAR_RE = /^(.*?)\s+(\d)\*\s*.*$/;
const SLUG_RE = /\/hotel\/([A-Za-z0-9\-_]+)\//;
const CURRENCY_SYMBOLS = { $: "USD", "€": "EUR", "£": "GBP" };

function toPortalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) throw new Error(`Bad date ${JSON.stringify(iso)}: use YYYY-MM-DD`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new Error(`Bad date ${JSON.stringify(iso)}: use YYYY-MM-DD`);
  }
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function travellersAges(adults, childAges) {
  return [...Array(adults).fill(ADULT_AGE), ...((childAges || []).map(Number))].join("-");
}

function normalizeAvailability(raw) {
  const text = String(raw || "").trim();
  if (!text) return "unknown";
  const low = text.toLowerCase().replace(/[_-]/g, " ");
  if (low === "rq" || low === "r q" || low.includes("on request") || low.replace(/ /g, "").includes("onrequest")) {
    return "on_request";
  }
  return text;
}

function intOrNull(v) {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function floatOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, "").replace(/ /g, ""));
  return Number.isFinite(n) ? n : null;
}

function splitNameStars(full) {
  const m = STAR_RE.exec(String(full || "").trim());
  if (m) return [m[1].trim(), parseInt(m[2], 10)];
  return [String(full || "").trim(), null];
}

function qqData($row) {
  const raw = $row.find(".qq-btn-place").first().attr("data-value");
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function parseSearchFragment(html) {
  // Fragments are bare <tr> rows; wrap in <table> so the HTML parser keeps them.
  const $ = cheerio.load("<table>" + (html || "") + "</table>");
  const hiddenNum = (sel, def) => {
    const el = $(sel).first();
    if (!el.length) return def;
    return intOrNull(el.attr("value") ?? el.text()) ?? def;
  };
  const partNumber = hiddenNum(".part-number", 1);
  const partsTotal = hiddenNum(".parts-total", 1);

  const rows = [];
  $("tr.hotel-list-item-wrapper").each((_, tr) => {
    const $row = $(tr);
    const qq = qqData($row);
    const hotelId = String($row.attr("data-hotel-id") || "");

    const href = String($row.find("a.hotel-card__title-link").first().attr("href") || "");
    const slugM = SLUG_RE.exec(href);
    const hotelSlug = slugM ? slugM[1] : "";
    const [hotelName, starRating] = splitNameStars(
      $row.find(".hotel-card__title-link-td-name").first().text()
    );

    const resort = $row.find(".hotel-card__location-link--resort").first().text().trim();
    const region = String(qq.region || "");

    let price = floatOrNull(qq.price);
    const $priceEl = $row.find("[data-price]").first();
    if (price === null && $priceEl.length) price = floatOrNull($priceEl.attr("data-price"));
    if (price === null) return; // chrome/placeholder row without a price

    let currency = String(qq.currency || "");
    if (!currency) {
      const sym = $row.find(".hotel-card__price-currency").first().text().trim();
      currency = CURRENCY_SYMBOLS[sym] || sym || "USD";
    }

    const mealIcons = $row.find(".meal-type-and-vehicle-icons").first().text().trim();
    const tds = $row.find("td").toArray();
    let priceIdx = -1;
    tds.forEach((td, i) => {
      if (priceIdx === -1 && $(td).find("[data-price]").length) priceIdx = i;
    });
    const candidates = [];
    if (priceIdx > 0) candidates.push($(tds[priceIdx - 1]).text().trim());
    tds.forEach((td) => candidates.push($(td).text().trim()));
    let availability = "unknown";
    for (const text of candidates) {
      if (!text) continue;
      if (text.toUpperCase() === "RQ" || text.toLowerCase().includes("request")) {
        availability = "on_request";
        break;
      }
    }
    if (availability === "unknown") log.debug("unrecognized availability cells: %j", candidates.slice(0, 8));

    rows.push({
      hotel_name: hotelName,
      resort: resort || region,
      atoll: region || resort,
      star_rating: starRating,
      room_type: String(qq.roomType || ""),
      meal_plan: String(qq.boardType || "") || mealIcons,
      availability,
      net_price: price,
      currency: currency || "USD",
      hotel_id: hotelId,
      hotel_slug: hotelSlug,
    });
  });
  return { rows, partNumber, partsTotal };
}

function buildPortalParams({ csrfToken, dateStart, dateEnd, adults, childs, agesDash, nationalityId, rateCode, partNumber }) {
  return [
    ["csrfmiddlewaretoken", csrfToken],
    ["request_with", "country_id"],
    ["request_value", DEST_COUNTRY_ID],
    ["resort_slug", ""],
    ["country_slug", ""],
    ["features", ""],
    ["stars", ""],
    ["price_from", ""],
    ["price_to", ""],
    ["currency", "USD"],
    ["rate_code", rateCode],
    ["search_type", ""],
    ["travellers_ages", agesDash],
    ["main_country_id", DEST_COUNTRY_ID],
    ["hotel_ids", ""],
    ["resort_ids", ""],
    ["feature_ids", ""],
    ["stars_ids", ""],
    ["meal_plan", ""],
    ["meal_plans", ""],
    ["hotel_sort", ""],
    ["hotel_limit", ""],
    ["hotels_list_view", ""],
    ["calc_source", ""],
    ["fast", ""],
    ["destination", DEST_LABEL],
    ["date_start", dateStart],
    ["date_end", dateEnd],
    ["adults", String(adults)],
    ["childs", String(childs)],
    ["guests", DEFAULT_GUESTS],
    ["nationality", nationalityId],
    ["any_resort", "on"],
    ["any_star", "on"],
    ["any_hotel", "on"],
    ["any_meal", "on"],
    ["part_number", String(partNumber)],
  ];
}

async function assertOk(res, what) {
  if (res.status >= 400) throw new Error(`${what} failed: HTTP ${res.status}`);
}

async function searchAll(session, { dateStart, dateEnd, adults, childs, agesDash, nationalityId, rateCode, stars = null, resort = null }) {
  const all = [];
  let partsTotal = 1;
  let part = 1;
  const needle = String(resort || "").trim().toLowerCase();
  while (part <= Math.min(partsTotal, MAX_PARTS)) {
    const res = await session.request("GET", SEARCH_PATH, {
      params: buildPortalParams({
        csrfToken: session.csrfToken || "",
        dateStart, dateEnd, adults, childs, agesDash,
        nationalityId, rateCode, partNumber: part,
      }),
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: session.baseUrl.replace(/\/+$/, "") + SEARCH_REFERER_PATH,
      },
    });
    await assertOk(res, "Portal search");
    const { rows, partsTotal: pt } = parseSearchFragment(await res.text());
    partsTotal = pt;
    log.debug("search part %s/%s: %s priced rows", part, partsTotal, rows.length);
    for (const row of rows) {
      if (stars !== null && stars !== undefined && row.star_rating !== stars) continue;
      if (needle && !`${row.hotel_name} ${row.resort}`.toLowerCase().includes(needle)) continue;
      all.push(row);
    }
    if (part >= partsTotal) break;
    part += 1;
  }
  if (!all.length) {
    log.info("Portal search returned zero availability (%s-%s adults=%s childs=%s nat=%s)",
      dateStart, dateEnd, adults, childs, nationalityId);
  }
  return { rows: all, partsTotal };
}

module.exports = {
  SEARCH_PATH,
  DEST_COUNTRY_ID,
  DEFAULT_RATE_CODE,
  toPortalDate,
  travellersAges,
  normalizeAvailability,
  parseSearchFragment,
  buildPortalParams,
  searchAll,
};
