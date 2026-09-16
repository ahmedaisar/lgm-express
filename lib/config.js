"use strict";

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

module.exports = {
  portalBaseUrl: process.env.PORTAL_BASE_URL || "https://agent.letsgomaldives.com",
  portalLoginPath: process.env.PORTAL_LOGIN_PATH || "/login/",
  portalUsername: process.env.PORTAL_USERNAME || "",
  portalPassword: process.env.PORTAL_PASSWORD || "",
  portalRateCode: process.env.PORTAL_RATE_CODE || "7ZV5P",
  maxConcurrentPortalRequests: num("MAX_CONCURRENT_PORTAL_REQUESTS", 4),
  portalTimeoutSeconds: num("PORTAL_TIMEOUT_SECONDS", 30),
  markup: num("MARKUP", 10),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  nationalityMappingPath:
    process.env.NATIONALITY_MAPPING_PATH || "lib/data/nationality_mapping.json",
  port: num("PORT", 8000),
};
