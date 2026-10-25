"use strict";

const crypto = require("node:crypto");

/**
 * Small bounded in-process TTL cache for data that is safe to reuse within a
 * single warm process. This cache is intentionally not a distributed cache.
 */
class TtlCache {
  constructor({ ttlMs = 30_000, maxEntries = 500, now = Date.now } = {}) {
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.maxEntries = Math.max(1, Number.isFinite(Number(maxEntries)) ? Math.floor(Number(maxEntries)) : 500);
    this.now = now;
    this.entries = new Map();
  }

  static stableKey(value) {
    const canonicalize = (input) => {
      if (input === null || typeof input !== "object") return input;
      if (Array.isArray(input)) return input.map(canonicalize);
      const output = {};
      for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key]);
      return output;
    };
    return crypto.createHash("sha256")
      .update(JSON.stringify(canonicalize(value)))
      .digest("hex");
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Touch the entry to implement least-recently-used eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.ttlMs <= 0) return value;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return value;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { TtlCache };
