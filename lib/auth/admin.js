"use strict";

// Single-admin auth: ADMIN_USER/ADMIN_PASSWORD env, JWT bearer on /admin/*.
// Stateless (Vercel-safe). If admin env is unset, login + guard answer 503
// instead of crashing boot.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const log = require("../log");

let cachedSecret = null;

function configured() {
  return Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD);
}

function secret() {
  if (process.env.ADMIN_JWT_SECRET) return process.env.ADMIN_JWT_SECRET;
  if (!cachedSecret) {
    cachedSecret = crypto.randomBytes(32).toString("hex");
    log.warn("ADMIN_JWT_SECRET unset — ephemeral tokens issued (restart invalidates them)");
  }
  return cachedSecret;
}

function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function loginHandler(req, res) {
  if (!configured()) {
    return res.status(503).json({ detail: "admin not configured (ADMIN_USER/ADMIN_PASSWORD)" });
  }
  const { user, password } = req.body || {};
  if (!timingEqual(user || "", process.env.ADMIN_USER) || !timingEqual(password || "", process.env.ADMIN_PASSWORD)) {
    log.warn("failed admin login attempt from %s", req.ip);
    return res.status(401).json({ detail: "Invalid admin credentials" });
  }
  const token = jwt.sign({ sub: String(user) }, secret(), { expiresIn: "12h" });
  return res.json({ token, expires_in: "12h" });
}

function requireAdmin(req, res, next) {
  if (!configured()) {
    return res.status(503).json({ detail: "admin not configured (ADMIN_USER/ADMIN_PASSWORD)" });
  }
  const header = String(req.get("Authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ detail: "Bearer token required" });
  try {
    const payload = jwt.verify(token, secret());
    req.admin = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

module.exports = { configured, loginHandler, requireAdmin };
