"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { applyMarkup } = require("../lib/pricing");

describe("markup", () => {
  it("defaults to ten percent", () => {
    assert.equal(applyMarkup(1000, 10), 1100);
    assert.equal(applyMarkup(13995.5, 10), 15395.05);
  });

  it("custom and zero", () => {
    assert.equal(applyMarkup(1000, 25), 1250);
    assert.equal(applyMarkup(1000, 0), 1000);
  });

  it("null passthrough", () => {
    assert.equal(applyMarkup(null, 10), null);
    assert.equal(applyMarkup(undefined, 10), null);
  });
});
