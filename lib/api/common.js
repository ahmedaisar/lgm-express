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
  const parts = String(raw).split(",").map((p) => p.trim());
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) {
    throw new HttpError(422, "child_ages must be comma-separated whole numbers, e.g. ?child_ages=6,10");
  }
  const ages = parts.map(Number);
  if (ages.some((a) => !Number.isSafeInteger(a) || a < 0 || a > 17)) {
    throw new HttpError(422, "child_ages must contain ages from 0 through 17");
  }
  if (ages.length !== childs) {
    throw new HttpError(422, `child_ages has ${ages.length} entries but childs=${childs}`);
  }
  return ages;
}

function parseDateParam(value, name) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(422, `Bad ${name}: use YYYY-MM-DD`);
  }
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(422, `Bad ${name}: not a valid calendar date`);
  }
  return raw;
}

function parseIntParam(value, def, { min = -Infinity, max = Infinity, name = "param" } = {}) {
  if (value === undefined || value === null || value === "") return def;
  const raw = String(value);
  if (!/^-?\d+$/.test(raw)) {
    throw new HttpError(422, `Bad ${name}: ${JSON.stringify(value)}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new HttpError(422, `Bad ${name}: ${JSON.stringify(value)}`);
  }
  return n;
}

module.exports = { HttpError, parseChildAges, parseDateParam, parseIntParam };
