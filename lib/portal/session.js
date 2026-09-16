"use strict";

const cheerio = require("cheerio");
const { CookieJar } = require("../cookies");
const log = require("../log");

function joinUrl(base, path) {
  return new URL(path, base.endsWith("/") ? base : base + "/").toString();
}

function extractCsrf(html) {
  const $ = cheerio.load(html || "");
  for (const name of ["csrfmiddlewaretoken", "csrf_token", "_token"]) {
    const v = $(`input[name="${name}"]`).first().attr("value");
    if (v) return v;
  }
  for (const name of ["csrf-token", "csrf_token"]) {
    const v = $(`meta[name="${name}"]`).first().attr("content");
    if (v) return v;
  }
  return null;
}

class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.current = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.current < this.max) {
      this.current += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.current += 1;
  }
  release() {
    this.current -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

function isTransient(err) {
  // Undici fetch raises TypeError on connection failures and AbortError/DOMException on timeouts.
  return (
    err instanceof TypeError ||
    err?.name === "AbortError" ||
    err?.name === "TimeoutError"
  );
}

class PortalSession {
  constructor({ baseUrl, username, password, loginPath = "/login/", timeoutMs = 30000, maxConcurrent = 4 }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.loginPath = loginPath;
    this.timeoutMs = timeoutMs;
    this.semaphore = new Semaphore(maxConcurrent);
    this.jar = new CookieJar();
    this.csrfToken = null;
    this.loggedIn = false;
  }

  get loginUrl() {
    return joinUrl(this.baseUrl, this.loginPath.replace(/^\//, ""));
  }

  get loginPageUrl() {
    // The rendered login form lives at /login-page/ (GET /login/ itself
    // is a 302 with an empty body, so it yields no CSRF token).
    return joinUrl(this.baseUrl, "login-page/");
  }

  async _fetch(url, { method = "GET", headers = {}, body, followRedirects = false } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { Cookie: this.jar.header(), ...headers },
        body,
        redirect: followRedirects ? "follow" : "manual",
        signal: ctrl.signal,
      });
      this.jar.storeFromHeaders(res.headers);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  static _isExpiredStatus(status) {
    // The portal's data endpoints always answer 200 directly, never 3xx.
    if (status >= 300 && status < 400) return true;
    return status === 401 || status === 403;
  }

  async _verifyAuthenticated() {
    try {
      const probe = await this._fetch(joinUrl(this.baseUrl, "profile-settings/"), {
        followRedirects: true,
      });
      if (probe.status !== 200) {
        log.debug("auth probe -> HTTP %s", probe.status);
        return false;
      }
      const text = await probe.text();
      const ok = !text.includes("userpassword") && text.includes("/logout/");
      log.debug("auth probe authenticated=%s", ok);
      return ok;
    } catch {
      return false;
    }
  }

  async login() {
    if (!this.username || !this.password) {
      throw new Error("PORTAL_USERNAME/PORTAL_PASSWORD are not set");
    }
    await this.semaphore.acquire();
    try {
      // 1. Fresh CSRF + cookies from the rendered login page itself.
      let token = null;
      for (const pageUrl of [this.loginPageUrl, this.loginUrl]) {
        try {
          const page = await this._fetch(pageUrl);
          if (page.status !== 200) continue;
          token = extractCsrf(await page.text());
          if (token) break;
        } catch (err) {
          if (!isTransient(err)) throw err;
        }
      }
      if (token) this.csrfToken = token;
      else log.debug("no CSRF token found on login pages; trying without");

      // 2. Submit credentials with the token.
      const form = new URLSearchParams({
        useremail: this.username,
        userpassword: this.password,
      });
      if (this.csrfToken) form.set("csrfmiddlewaretoken", this.csrfToken);
      const headers = {};
      if (this.csrfToken) {
        headers["X-CSRFToken"] = this.csrfToken;
        headers["Referer"] = this.loginUrl;
      }
      const post = await this._fetch(this.loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body: form.toString(),
      });
      log.info(
        "login POST -> HTTP %s location=%s",
        post.status,
        post.headers.get("location") || "-"
      );
      if (post.status >= 400) {
        log.warn("Portal login failed: HTTP %s (check PORTAL_* creds/paths)", post.status);
        throw new Error(`Portal login failed: HTTP ${post.status}`);
      }
      // Any redirect (even back to `/`) may be a rejection, and a 200 may be
      // a re-rendered login form — only the probe decides.
      if (!(await this._verifyAuthenticated())) {
        log.warn("Portal login failed: credentials rejected (no authenticated session established)");
        this.loggedIn = false;
        throw new Error(
          "Portal login failed: credentials rejected — check PORTAL_USERNAME/PORTAL_PASSWORD"
        );
      }
      this.loggedIn = true;
      log.info("Portal login OK as shared agency session");
    } finally {
      this.semaphore.release();
    }
  }

  async ensureLogin() {
    if (!this.loggedIn) await this.login();
  }

  async request(method, path, { params, data, json, headers = {}, retryOnExpiry = true } = {}) {
    await this.ensureLogin();
    let url = path.startsWith("http") ? path : this.baseUrl + path;
    if (params) {
      const qs = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    }
    let body;
    const outHeaders = { ...headers };
    if (data !== undefined) {
      body = data instanceof URLSearchParams ? data.toString() : new URLSearchParams(data).toString();
      outHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (json !== undefined) {
      body = JSON.stringify(json);
      outHeaders["Content-Type"] = "application/json";
    }

    const once = async () => {
      await this.semaphore.acquire();
      try {
        const reqHeaders = { ...outHeaders };
        if (this.csrfToken) {
          reqHeaders["X-CSRFToken"] = this.csrfToken;
          reqHeaders["Referer"] = this.baseUrl + "/";
        }
        const res = await this._fetch(url, { method, headers: reqHeaders, body });
        log.debug("portal %s %s -> %s", method, path, res.status);
        return res;
      } finally {
        this.semaphore.release();
      }
    };

    const withRetry = async () => {
      try {
        return await once();
      } catch (err) {
        if (!isTransient(err)) throw err;
        log.info("transient portal network error (%s) — retrying once", err.name || "fetch");
        return await once();
      }
    };

    let response = await withRetry();
    if (retryOnExpiry && PortalSession._isExpiredStatus(response.status)) {
      log.info("Portal session expired — re-logging in once");
      this.loggedIn = false;
      await this.login();
      response = await withRetry();
    }
    return response;
  }

  status() {
    return {
      base_url: this.baseUrl,
      logged_in: this.loggedIn,
      has_csrf: this.csrfToken !== null,
    };
  }
}

module.exports = { PortalSession, extractCsrf, Semaphore };
