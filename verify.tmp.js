"use strict";

require("dotenv").config();
const config = require("./lib/config");
const { PortalSession } = require("./lib/portal/session");

async function main() {
  const session = new PortalSession({
    baseUrl: config.portalBaseUrl,
    username: config.portalUsername,
    password: config.portalPassword,
    loginPath: config.portalLoginPath,
    timeoutMs: 60000,
    maxConcurrent: 1,
  });

  await session.login();
  console.log("LOGIN OK");

  const res = await session.request("GET", "/profile/hotels/hotel-search/", {
    retryOnExpiry: false,
  });
  const text = await res.text();
  console.log("status", res.status, "len", text.length);

  const interesting = text.match(/[^\s"']*(?:hotel-search|-hotel|ajax)[^\s"']*/gi) || [];
  console.log("INTERESTING PATHS:");
  for (const p of [...new Set(interesting)].slice(0, 60)) console.log("  ", p);

  const scripts = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const s of scripts) {
    if (/|ajax|url/i.test(s)) {
      const urls = s.match(/["']([^"']*(?:|ajax)[^"']*)["']/gi) || [];
      if (urls.length) {
        console.log("SCRIPT URLS:");
        for (const u of [...new Set(urls)].slice(0, 40)) console.log("  ", u);
      }
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});