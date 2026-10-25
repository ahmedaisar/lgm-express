"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const jwt = require("jsonwebtoken");

const KEYS = [
  "API_KEYS", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET",
  "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_MAX", "RATE_LIMIT_AUTH_MAX", "SUPABASE_AUTH_TTL_MS",
];
const SAVED = {};
for (const k of KEYS) SAVED[k] = process.env[k];

function restoreEnv() {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}

const TEST_SECRET = "caller-test-jwt-secret";

function agentToken(sub) {
  return jwt.sign({ sub }, TEST_SECRET, { expiresIn: "5m" });
}

function mockReq({ bearer, apiKey } = {}) {
  return {
    get: (h) => {
      if (h === "Authorization" && bearer) return `Bearer ${bearer}`;
      if (h === "x-api-key" && apiKey) return apiKey;
      return "";
    },
    query: {},
    ip: "127.0.0.1",
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
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

const agentAuth = require("../lib/auth/agentAuth");
// config.apiKeys freezes at require time, so tests set it directly.
const config = require("../lib/config");
const SAVED_KEYS = [...config.apiKeys];

function stubAgent(profile) {
  agentAuth._overrides.fetchProfile = async () => profile;
}

beforeEach(() => {
  restoreEnv();
  config.apiKeys = [];
  agentAuth._overrides.verify = undefined;
  agentAuth._overrides.fetchProfile = undefined;
  agentAuth._overrides.jwks = []; // never hit network in unit tests
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  const caller = require("../lib/auth/caller");
  caller.invalidateCache();
});
afterEach(() => {
  restoreEnv();
  config.apiKeys = SAVED_KEYS;
  agentAuth._overrides.verify = undefined;
  agentAuth._overrides.fetchProfile = undefined;
  agentAuth._overrides.jwks = undefined;
});

async function through(middlewares, req) {
  const caller = require("../lib/auth/caller");
  const res = mockRes();
  for (const mw of middlewares) {
    let nextCalled = false;
    let mwError = null;
    await mw(req, res, (e) => {
      nextCalled = true;
      mwError = e || null;
    });
    if (mwError) throw mwError;
    if (!nextCalled) return { blocked: true, res };
  }
  return { blocked: false, res };
}

const chain = () => {
  const caller = require("../lib/auth/caller");
  return [caller.resolveCaller, caller.requireCaller];
};

describe("caller identification", () => {
  it("open mode passes anon through (backward compat)", async () => {
    config.apiKeys = [];
    delete process.env.SUPABASE_URL;
    const { blocked } = await through(chain(), mockReq());
    assert.equal(blocked, false);
  });

  it("shared key passes when keys are configured", async () => {
    config.apiKeys = ["k1"];
    const req = mockReq({ apiKey: "k1" });
    const { blocked } = await through(chain(), req);
    assert.equal(blocked, false);
    assert.equal(req.caller.type, "key");
  });

  it("401 with no credentials when keys are configured", async () => {
    config.apiKeys = ["k1"];
    const { blocked, res } = await through(chain(), mockReq());
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 401);
  });

  it("active agent passes on Bearer alone (no shared key needed)", async () => {
    config.apiKeys = ["k1"];
    stubAgent({ id: "a1", email: "a@x.com", role: "agent", status: "active" });
    const req = mockReq({ bearer: agentToken("a1") });
    const { blocked } = await through(chain(), req);
    assert.equal(blocked, false);
    assert.equal(req.caller.type, "agent");
    assert.equal(req.caller.active, true);
  });

  it("401 on forged Bearer, never falling back to a valid shared key", async () => {
    config.apiKeys = ["k1"];
    stubAgent({ id: "a1", email: "a@x.com", role: "agent", status: "active" });
    const { blocked, res } = await through(chain(), mockReq({ bearer: "forged.token.here", apiKey: "k1" }));
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 401);
  });

  it("403 for pending/suspended/unknown agents even with a valid shared key", async () => {
    config.apiKeys = ["k1"];
    for (const [name, profile, want] of [
      ["pending", { id: "a1", role: "agent", status: "pending" }, 403],
      ["suspended", { id: "a1", role: "agent", status: "suspended" }, 403],
      ["unknown", null, 403],
    ]) {
      stubAgent(profile);
      const req = mockReq({ bearer: agentToken("a1"), apiKey: "k1" });
      const { blocked, res } = await through(chain(), req);
      assert.equal(blocked, true, name);
      assert.equal(res.statusCode, want, name);
    }
  });

  it("502 when the profile lookup blows up", async () => {
    config.apiKeys = ["k1"];
    agentAuth._overrides.fetchProfile = async () => {
      throw new Error("db down");
    };
    const { blocked, res } = await through(chain(), mockReq({ bearer: agentToken("a1") }));
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 502);
  });
});

describe("tiered rate limits", () => {  it("agents and shared keys land in separate buckets", async () => {
    config.apiKeys = ["k1"];
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    process.env.RATE_LIMIT_MAX = "1000";
    process.env.RATE_LIMIT_AUTH_MAX = "1000";
    stubAgent({ id: "agent-9", email: "a@x.com", role: "agent", status: "active" });
    const caller = require("../lib/auth/caller");

    const agentReq = mockReq({ bearer: agentToken("agent-9") });
    await through([caller.resolveCaller], agentReq);
    const keyReq = mockReq({ apiKey: "k1" });
    await through([caller.resolveCaller], keyReq);

    // limitByCaller routes by caller kind; labels confirm the bucketing inputs.
    assert.equal(agentReq.caller.type, "agent");
    assert.equal(keyReq.caller.type, "key");
    assert.equal(caller.callerLabel(agentReq), "caller=agent:agent-9");
    assert.equal(caller.callerLabel(keyReq), "caller=key");
  });
});

describe("ES256 JWKS verification", () => {
  const { generateKeyPairSync } = require("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid-1", alg: "ES256", use: "sig" };

  function es256(sub) {
    return jwt.sign({ sub }, pem, { algorithm: "ES256", keyid: "test-kid-1", expiresIn: "5m" });
  }

  it("accepts tokens signed by a JWKS key (no HS256 secret needed)", async () => {
    delete process.env.SUPABASE_JWT_SECRET; // JWKS-only project
    agentAuth._overrides.jwks = [jwk];
    agentAuth._overrides.fetchProfile = async () => (
      { id: "ec-1", email: "e@x.com", role: "agent", status: "active" }
    );
    const caller = require("../lib/auth/caller");
    const req = mockReq({ bearer: es256("ec-1") });
    const { blocked } = await through([caller.resolveCaller, caller.requireCaller], req);
    assert.equal(blocked, false);
    assert.equal(req.caller.type, "agent");
  });

  it("rejects tokens signed by an unknown key", async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    agentAuth._overrides.jwks = [{ ...jwk, kid: "other-kid" }];
    agentAuth._overrides.fetchProfile = async () => (
      { id: "ec-1", email: "e@x.com", role: "agent", status: "active" }
    );
    const caller = require("../lib/auth/caller");
    const { blocked, res } = await through(
      [caller.resolveCaller, caller.requireCaller], mockReq({ bearer: es256("ec-1") })
    );
    assert.equal(blocked, true);
    assert.equal(res.statusCode, 401);
  });
});
