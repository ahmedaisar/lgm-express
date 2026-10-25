"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const overrides = {
  verify: undefined,
  fetchProfile: undefined,
  jwks: undefined,
};

async function fetchProfile(id) {
  if (overrides.fetchProfile) return overrides.fetchProfile(id);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = new URL("/rest/v1/agents", process.env.SUPABASE_URL);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", "id,email,role,status");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`agent profile lookup failed with HTTP ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function verify(token) {
  if (overrides.verify) return overrides.verify(token);
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try { return jwt.verify(token, secret, { algorithms: ["HS256"] }); } catch { return null; }
  }
  const keys = Array.isArray(overrides.jwks) ? overrides.jwks : [];
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) return null;
  const jwk = keys.find((key) => key.kid === decoded.header.kid && key.alg === decoded.header.alg);
  if (!jwk) return null;
  try {
    const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
    return jwt.verify(token, keyObject, { algorithms: ["ES256"] });
  } catch {
    return null;
  }
}

function reject(res, status, detail) {
  return res.status(status).json({ detail });
}

async function resolveAgent(req, res, next) {
  const header = String(req.get("Authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next();
  const claims = await verify(token);
  if (!claims?.sub) return reject(res, 401, "Invalid bearer token");
  let profile;
  try {
    profile = await fetchProfile(claims.sub);
  } catch {
    return reject(res, 502, "Caller identity could not be verified");
  }
  if (!profile || profile.status !== "active" || !["agent", "admin"].includes(profile.role)) {
    return reject(res, 403, "Caller is not active");
  }
  req.agent = profile;
  req.caller = { type: "agent", id: String(profile.id), active: true, role: profile.role };
  return next();
}

module.exports = {
  resolveAgent,
  _overrides: overrides,
  _verifyToken: verify,
};
