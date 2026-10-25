"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { HttpError, parseDateParam, parseIntParam, parseChildAges } = require("../lib/api/common");

describe("request parameter validation", () => {
  it("accepts a real calendar date", () => {
    assert.equal(parseDateParam("2026-10-26", "date_start"), "2026-10-26");
  });

  it("rejects impossible dates, including leap-day mistakes", () => {
    for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"]) {
      assert.throws(
        () => parseDateParam(value, "date_start"),
        (err) => err instanceof HttpError && err.status === 422
      );
    }
  });

  it("rejects integer prefixes and unsafe integer values", () => {
    for (const value of ["2people", "1.5", "1e2", "9007199254740992"]) {
      assert.throws(
        () => parseIntParam(value, 2, { min: 1, name: "adults" }),
        (err) => err instanceof HttpError && err.status === 422
      );
    }
    assert.equal(parseIntParam("3", 2, { min: 1, max: 8, name: "adults" }), 3);
  });

  it("validates child ages, including empty segments and range", () => {
    assert.deepEqual(parseChildAges("6,10", 2), [6, 10]);
    for (const value of ["6,,10", "6,abc", "-1", "18", "1.5"]) {
      assert.throws(
        () => parseChildAges(value, value.split(",").length),
        (err) => err instanceof HttpError && err.status === 422
      );
    }
  });
});
