"use strict";

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function parseChildAges(raw, childs) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    if (childs > 0) {
      throw new HttpError(422, "child_ages is required when childs>0, e.g. ?childs=2&child_ages=6,10");
    }
    return null;
  }
  const parts = String(raw).split(",").map((p) => p.trim()).filter(Boolean);
  const ages = parts.map((p) => parseInt(p, 10));
  if (ages.some((a) => !Number.isFinite(a))) {
    throw new HttpError(422, "child_ages must be comma-separated ints, e.g. ?child_ages=6,10");
  }
  if (ages.length !== childs) {
    throw new HttpError(422, `child_ages has ${ages.length} entries but childs=${childs}`);
  }
  return ages;
}

function parseDateParam(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new HttpError(422, `Bad ${name}: use YYYY-MM-DD`);
  }
  return String(value);
}

function parseIntParam(value, def, { min = -Infinity, max = Infinity, name = "param" } = {}) {
  if (value === undefined || value === null || value === "") return def;
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(422, `Bad ${name}: ${JSON.stringify(value)}`);
  }
  return n;
}

module.exports = { HttpError, parseChildAges, parseDateParam, parseIntParam };
