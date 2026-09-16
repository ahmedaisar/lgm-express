"use strict";

// Minimal cookie jar: the portal only needs name=value round-tripping
// (sessionid / csrftoken / user_id). No domain/path matching.
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  storeFromHeaders(headers) {
    const setCookies =
      typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of setCookies) {
      const pair = String(line).split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  names() {
    return [...this.cookies.keys()];
  }
}

module.exports = { CookieJar };
