"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const config = require("../lib/config");
const log = require("../lib/log");
const { PortalSession } = require("../lib/portal/session");
const { loadMapping, resolveNationality } = require("../lib/data/nationality");
const { searchAll, toPortalDate, travellersAges } = require("../lib/portal/search");
const { HotelNotFound, getHotelQuote } = require("../lib/portal/hotel");
const { applyMarkup } = require("../lib/pricing");
const store = require("../lib/cms/store");
const csv = require("../lib/cms/csv");
const merge = require("../lib/cms/merge");
const admin = require("../lib/auth/admin");
const multer = require("multer");
const cors = require("cors");
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
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : true }));

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
    const marked = rows
      .slice(start, start + perPage)
      .map((r) => ({ ...r, net_price: applyMarkup(r.net_price, config.markup) }));
    const enriched = merge.enrichSearchRows(marked, store.list());
    res.json({
      results: enriched,
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
    for (const room of quote.rooms) {
      room.net_price = applyMarkup(room.net_price, config.markup);
    }
    res.json(merge.enrichQuote(quote, store.list()));
  } catch (err) {
    sendError(res, err);
  }
});

// ---- Admin CMS (Bearer JWT, see lib/auth/admin.js) ----
app.post("/admin/login", admin.loginHandler);

app.get("/admin/hotels", admin.requireAdmin, (req, res) => {
  try {
    res.json(store.list());
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/admin/hotels", admin.requireAdmin, (req, res) => {
  try {
    res.status(201).json(store.create(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/admin/hotels/:id", admin.requireAdmin, (req, res) => {
  try {
    const rec = store.get(req.params.id);
    if (!rec) return res.status(404).json({ detail: `CMS hotel ${JSON.stringify(req.params.id)} not found` });
    res.json(rec);
  } catch (err) {
    sendError(res, err);
  }
});

app.put("/admin/hotels/:id", admin.requireAdmin, (req, res) => {
  try {
    const rec = store.update(req.params.id, req.body || {});
    if (!rec) return res.status(404).json({ detail: `CMS hotel ${JSON.stringify(req.params.id)} not found` });
    res.json(rec);
  } catch (err) {
    sendError(res, err);
  }
});

app.delete("/admin/hotels/:id", admin.requireAdmin, (req, res) => {
  try {
    if (!store.remove(req.params.id)) {
      return res.status(404).json({ detail: `CMS hotel ${JSON.stringify(req.params.id)} not found` });
    }
    res.json({ deleted: req.params.id });
  } catch (err) {
    sendError(res, err);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.post("/admin/import", admin.requireAdmin, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(422).json({ detail: "multipart field 'file' (.csv) is required" });
    if (!/\.csv$/i.test(req.file.originalname || "")) {
      return res.status(422).json({ detail: "only .csv uploads are accepted" });
    }
    res.json(csv.importCsv(req.file.buffer.toString("utf-8")));
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/admin/export", admin.requireAdmin, (req, res) => {
  try {
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="cms-export.csv"');
    res.send(csv.toCsv(store.list()));
  } catch (err) {
    sendError(res, err);
  }
});

// Admin UI (static SPA; data calls carry the Bearer token).
// Mounted after the /admin/* API routes so they match first.
// NOTE: plain "/admin" matches "/admin/" too (non-strict routing), so only
// redirect the slash-less form or /admin/ loops forever.
app.get("/admin", (req, res, next) => {
  if (req.path === "/admin") return res.redirect("/admin/");
  return next();
});
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

// Vercel (serverless import) vs direct run.
if (require.main === module) {
  app.listen(config.port, () => log.info("listening on %s", config.port));
}

module.exports = app;
