"use strict";

require("dotenv").config();

const express = require("express");
const config = require("../lib/config");
const log = require("../lib/log");
const { PortalSession } = require("../lib/portal/session");
const { loadMapping, resolveNationality } = require("../lib/data/nationality");
const { searchAll, toPortalDate, travellersAges } = require("../lib/portal/search");
const { HotelNotFound, getHotelQuote } = require("../lib/portal/hotel");
const { HttpError, parseChildAges, parseDateParam, parseIntParam } = require("../lib/api/common");

const portal = new PortalSession({
  baseUrl: config.portalBaseUrl,
  username: config.portalUsername,
  password: config.portalPassword,
  loginPath: config.portalLoginPath,
  timeoutMs: config.portalTimeoutSeconds * 1000,
  maxConcurrent: config.maxConcurrentPortalRequests,
});

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    log.info("%s %s -> %s (%sms)", req.method, req.path, res.statusCode, Date.now() - start);
  });
  next();
});

function sendError(res, err) {
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers || {})) res.set(k, v);
    return res.status(err.status).json({ detail: err.message });
  }
  if (/credentials rejected|PORTAL_USERNAME/.test(err.message || "")) {
    return res.status(502).json({ detail: `portal login failed: ${err.message}` });
  }
  if (err instanceof HotelNotFound) {
    return res.status(404).json({ detail: err.message });
  }
  log.warn("portal upstream error: %s", err.message || err);
  return res.status(502).json({ detail: `portal request failed: ${err.message || err}` });
}

function bookingParams(req) {
  const dateStart = parseDateParam(req.query.date_start, "date_start");
  const dateEnd = parseDateParam(req.query.date_end, "date_end");
  if (dateEnd < dateStart) throw new HttpError(422, "date_end must be on or after date_start");
  const adults = parseIntParam(req.query.adults, 2, { min: 1, max: 16, name: "adults" });
  const childs = parseIntParam(req.query.childs, 0, { min: 0, max: 10, name: "childs" });
  const childAges = parseChildAges(req.query.child_ages ?? null, childs);
  if (!req.query.nationality) throw new HttpError(422, "nationality is required");
  const nationalityId = resolveNationality(req.query.nationality, loadMapping());
  return {
    portalStart: toPortalDate(dateStart),
    portalEnd: toPortalDate(dateEnd),
    adults,
    childs,
    agesDash: travellersAges(adults, childAges),
    childAges,
    nationalityId,
  };
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", ...portal.status() });
});

app.get("/health/portal", async (req, res) => {
  try {
    await portal.ensureLogin();
    res.json({ portal: "reachable", ...portal.status() });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/search", async (req, res) => {
  try {
    const b = bookingParams(req);
    const stars = req.query.stars === undefined || req.query.stars === ""
      ? null
      : parseIntParam(req.query.stars, null, { min: 1, max: 7, name: "stars" });
    const page = parseIntParam(req.query.page, 1, { min: 1, name: "page" });
    const perPage = parseIntParam(req.query.per_page, 20, { min: 1, max: 100, name: "per_page" });
    const { rows, partsTotal } = await searchAll(portal, {
      dateStart: b.portalStart,
      dateEnd: b.portalEnd,
      adults: b.adults,
      childs: b.childs,
      agesDash: b.agesDash,
      nationalityId: b.nationalityId,
      rateCode: config.portalRateCode,
      stars,
      resort: req.query.resort ?? null,
    });
    const start = (page - 1) * perPage;
    res.json({
      results: rows.slice(start, start + perPage),
      page,
      per_page: perPage,
      total: rows.length,
      parts_total: partsTotal,
      availability: rows.length ? "ok" : "no_results",
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/hotels/:hotelId", async (req, res) => {
  try {
    const effectiveSlug = req.query.slug || req.params.hotelId;
    if (/^\d+$/.test(String(effectiveSlug || ""))) {
      return res.status(404).json({
        detail: `Hotel ${JSON.stringify(req.params.hotelId)} not found — pass hotel_slug from /search (numeric ids have no portal route)`,
      });
    }
    const b = bookingParams(req);
    const quote = await getHotelQuote(portal, {
      slug: effectiveSlug,
      dateStart: b.portalStart,
      dateEnd: b.portalEnd,
      adults: b.adults,
      childs: b.childs,
      childAges: b.childAges,
      nationalityId: b.nationalityId,
      rateCode: config.portalRateCode,
    });
    res.json(quote);
  } catch (err) {
    sendError(res, err);
  }
});

// Vercel (serverless import) vs direct run.
if (require.main === module) {
  app.listen(config.port, () => log.info("listening on %s", config.port));
}

module.exports = app;
