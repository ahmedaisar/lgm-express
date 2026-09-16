"use strict";

// Nationality mapping: ISO3 / country name -> portal numeric country ID.
// Source of truth is the static 249-country table extracted from the live
// portal dropdown. Callers never see portal-internal IDs.

const fs = require("fs");
const path = require("path");

const cache = new Map();

function defaultPath() {
  const fromEnv = process.env.NATIONALITY_MAPPING_PATH;
  if (fromEnv) return path.resolve(fromEnv);
  // __dirname-based: independent of the process working directory,
  // which serverless runtimes don't guarantee.
  return path.join(__dirname, "nationality_mapping.json");
}

function loadMapping(filePath = defaultPath()) {
  if (cache.has(filePath)) return cache.get(filePath);
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`Nationality mapping at ${filePath} is empty or invalid`);
  }
  cache.set(filePath, data);
  return data;
}

function resolveNationality(value, mapping) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("nationality is required");
  if (/^\d+$/.test(raw)) return raw;
  const upper = raw.toUpperCase();
  for (const entry of mapping) {
    if (String(entry.iso3 || "").toUpperCase() === upper) return String(entry.id);
  }
  const lower = raw.toLowerCase();
  const matches = mapping.filter((e) => String(e.name || "").toLowerCase() === lower);
  if (matches.length === 1) return String(matches[0].id);
  if (matches.length) {
    throw new Error(
      `Ambiguous nationality ${JSON.stringify(value)}: matches ${matches.slice(0, 5).map((m) => m.name).join(", ")}`
    );
  }
  throw new Error(`Unknown nationality ${JSON.stringify(value)}: use ISO3 (e.g. USA) or country name`);
}

module.exports = { loadMapping, resolveNationality };
