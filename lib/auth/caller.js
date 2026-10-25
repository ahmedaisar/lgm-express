"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const agentAuth = require("./agentAuth");
const configShared = require("../config");

const config = configShared;

const overrides = {
  verify: undefined,
  fetchProfile: undefined,
  jwks: undefined,
};

let profileCache = new Map();
function invalidateCache() {
  profileCache.clear();
}

function callerLabel(req) {
  if (req.caller?.type === "agent") return `caller=agent:${req.caller.id}`;
  if (req.caller?.type === "key") return "caller=key";
  return "caller=anon";
}

function authError(res, status, detail) {
  return res.status(status).json({ detail });
}

async function fetchProfile(id) {
  if (overrides.fetchProfile) return overrides.fetchProfile(id);
  if (agentAuth._overrides.fetchProfile) return agentAuth._overrides.fetchProfile(id);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = new URL("/rest/v1/agents", process.env.SUPABASE_URL);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", "id,email,role,status");
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`agent profile lookup failed with HTTP ${response.status}`);
  const records = await response.json();
  return Array.isArray(records) ? records[0] || null : null;
}

async function verifyToken(token) {
  if (overrides.verify) return overrides.verify(token);
  if (agentAuth._overrides.verify || agentAuth._overrides.jwks) return agentAuth._verifyToken(token);
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
}

async function resolveCaller(req, res, next) {
  const authorization = String(req.get("Authorization") || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const suppliedKey = String(req.get("x-api-key") || "");
  if (token) {
    const claims = await verifyToken(token);
    if (!claims || !claims.sub) return authError(res, 401, "Invalid bearer token");
    let profile;
    try {
      profile = await fetchProfile(claims.sub);
    } catch {
      return authError(res, 502, "Caller identity could not be verified");
    }
    if (!profile || profile.status !== "active" || !["agent", "admin"].includes(profile.role)) {
      return authError(res, 403, "Caller is not active");
    }
    req.caller = { type: "agent", id: String(profile.id), active: true, role: profile.role };
    return next();
  }
  if (config.apiKeys.length) {
    const keyMatches = config.apiKeys.some((candidate) => {
      const a = Buffer.from(candidate);
      const b = Buffer.from(suppliedKey);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!keyMatches) return authError(res, 401, "API key required");
    req.caller = { type: "key", active: true };
    return next();
  }
  // Preserve legacy anonymous mode when no auth mechanisms are configured.
  req.caller = { type: "anon", active: true };
  return next();
}

function requireCaller(req, res, next) {
  if (!req.caller) return authError(res, 401, "Caller authentication required");
  return next();
}

module.exports = {
  resolveCaller,
  requireCaller,
  callerLabel,
  invalidateCache,
};
