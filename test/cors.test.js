"use strict";
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const app = require("../api/index.js");

describe("cors", () => {
  it("answers preflight with an allow-origin header", async () => {
    const server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${base}/health`, { headers: { Origin: "https://example.test" } });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("access-control-allow-origin"), "missing ACAO header");
    } finally {
      server.close();
    }
  });
});
