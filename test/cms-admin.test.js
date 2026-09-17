"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");

const admin = require("../lib/auth/admin");

const SAVED = {};
for (const k of ["ADMIN_USER", "ADMIN_PASSWORD", "ADMIN_JWT_SECRET"]) {
  SAVED[k] = process.env[k];
}
beforeEach(() => {
  process.env.ADMIN_USER = "boss";
  process.env.ADMIN_PASSWORD = "s3cret";
  process.env.ADMIN_JWT_SECRET = "test-secret-for-unit-tests-only";
});
afterEach(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

function loginAs(user, password) {
  const res = mockRes();
  admin.loginHandler({ body: { user, password }, ip: "test" }, res);
  return res;
}

describe("admin auth", () => {
  it("503 when admin env is unset", () => {
    delete process.env.ADMIN_USER;
    const res = mockRes();
    admin.loginHandler({ body: {}, ip: "test" }, res);
    assert.equal(res.statusCode, 503);
    let nextCalled = false;
    const guard = mockRes();
    admin.requireAdmin({ get: () => "", ip: "test" }, guard, () => {
      nextCalled = true;
    });
    assert.equal(guard.statusCode, 503);
    assert.equal(nextCalled, false);
  });

  it("login rejects wrong credentials, issues token for correct ones", () => {
    const bad = loginAs("boss", "nope");
    assert.equal(bad.statusCode, 401);
    const ok = loginAs("boss", "s3cret");
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.body.token);
    assert.equal(ok.body.expires_in, "12h");
  });

  it("guard passes valid bearer, rejects missing/bad tokens", () => {
    const { token } = loginAs("boss", "s3cret").body;
    let adminUser = null;
    const good = mockRes();
    admin.requireAdmin(
      { get: (h) => (h === "Authorization" ? `Bearer ${token}` : ""), ip: "test" },
      good,
      () => {
        adminUser = "next";
      }
    );
    assert.equal(adminUser, "next");

    const missing = mockRes();
    let called = false;
    admin.requireAdmin({ get: () => "", ip: "test" }, missing, () => {
      called = true;
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(called, false);

    const forged = mockRes();
    admin.requireAdmin({ get: () => "Bearer forged.token.here", ip: "test" }, forged, () => {
      called = true;
    });
    assert.equal(forged.statusCode, 401);
    assert.equal(called, false);
  });
});
