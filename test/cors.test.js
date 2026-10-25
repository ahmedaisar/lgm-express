"use strict";
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

// Pin the allowlist before the app module (and its config) loads, so this
// test is hermetic regardless of the developer's local .env.
process.env.ALLOWED_ORIGINS = "https://example.test,https://other.test";
const app = require("../api/index.js");

describe("cors", () => {
  it("reflects allowlisted origins and blocks the rest", async () => {
    const server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const good = await fetch(`${base}/health`, { headers: { Origin: "https://example.test" } });
      assert.equal(good.status, 200);
      assert.equal(good.headers.get("access-control-allow-origin"), "https://example.test");
      const evil = await fetch(`${base}/health`, { headers: { Origin: "https://evil.test" } });
      assert.equal(evil.status, 200);
      assert.equal(evil.headers.get("access-control-allow-origin"), null);
    } finally {
      server.close();
    }
  });
});
