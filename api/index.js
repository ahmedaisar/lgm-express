"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const caller = require("../lib/auth/caller");
const supabaseAdmin = require("../lib/auth/supabaseAdmin");
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
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// Explicit origin allowlist. Requests without Origin (server-to-server clients)
// are permitted; browser origins are reflected only when allowlisted.
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: false,
}));

// In-memory per-instance limits provide a basic guard on serverless deployments.
// Configure durable edge-level limits as well if the service is public.
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) > 0
    ? Number(process.env.RATE_LIMIT_WINDOW_MS) : 60_000,
  limit: Number(process.env.RATE_LIMIT_MAX) > 0
    ? Number(process.env.RATE_LIMIT_MAX) : 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { detail: "Too many requests; please retry later" },
});
app.use(apiLimiter);
app.use((req, res, next) => {
  req.caller = { type: "anon", active: true };
  next();
});

app.use((req, res, next) => {
  const incomingId = String(req.get("X-Request-Id") || "").trim();
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(incomingId)
    ? incomingId
    : require("crypto").randomUUID();
  res.set("X-Request-Id", requestId);
  req.requestId = requestId;
  next();
});

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
  // Do not pass upstream response bodies, credentials, URLs, or network errors
  // through to callers. The full failure belongs in server-side logs.
  return res.status(502).json({
    detail: "Portal request failed",
    request_id: res.get("X-Request-Id"),
  });
}

function bookingParams(req) {
  const dateStart = parseDateParam(req.query.date_start, "date_start");
  const dateEnd = parseDateParam(req.query.date_end, "date_end");
  if (dateEnd < dateStart) throw new HttpError(422, "date_end must be on or after date_start");
  const adults = parseIntParam(req.query.adults, 2, { min: 1, max: 16, name: "adults" });
  const childs = parseIntParam(req.query.childs, 0, { min: 0, max: 10, name: "childs" });
  const childAges = parseChildAges(req.query.child_ages ?? null, childs);
  if (!req.query.nationality) throw new HttpError(422, "nationality is required");
  let nationalityId;
  try {
    nationalityId = resolveNationality(req.query.nationality, loadMapping());
  } catch (err) {
    throw new HttpError(422, err.message);
  }
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

app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.0.3",
    info: { title: "LGM Rate Proxy API", version: "0.2.0" },
    paths: {
      "/health": { get: { summary: "Application liveness" } },
      "/health/ready": { get: { summary: "Application readiness" } },
      "/health/portal": { get: { summary: "Portal connectivity" } },
      "/search": { get: { summary: "Search hotel availability" } },
      "/hotels/{hotelId}": { get: { summary: "Get hotel quote" } },
      "/admin/login": { post: { summary: "Administrator login" } },
      "/admin/hotels": {
        get: { summary: "List CMS hotels" },
        post: { summary: "Create a CMS hotel" },
      },
    },
  });
});

app.get("/health/ready", (req, res) => {
  try {
    const hotels = store.list();
    const mapping = loadMapping();
    const mappingCountries = mapping && typeof mapping === "object"
      ? Object.keys(mapping).length : 0;
    res.json({ status: "ok", cms_hotels: hotels.length, mapping_countries: mappingCountries });
  } catch (err) {
    log.warn("readiness check failed: %s", err.message || err);
    res.status(503).json({ status: "unready" });
  }
});

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
    const records = store.list();
    const queried = store.query(records, {
      q: req.query.q,
      atoll: req.query.atoll,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    res.json(queried);
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
