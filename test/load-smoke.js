"use strict";

// Load smoke (Phase 5): concurrent hammering of portal-free endpoints only
// (no portal contact, no real search). Boots the app on an ephemeral port
// unless --base is given.
//
// Usage: npm run load -- --requests 200 --concurrency 20 [--base http://host:8000]

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const REQUESTS = parseInt(arg("requests", "200"), 10);
const CONCURRENCY = parseInt(arg("concurrency", "20"), 10);
const BASE = arg("base", null);

// Test-friendly env before the app module loads.
process.env.API_KEYS = process.env.API_KEYS || "smoke-key";
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || "100000";
process.env.SEARCH_CACHE_TTL_MS = process.env.SEARCH_CACHE_TTL_MS || "0";

const app = require("../api/index.js");

const ROUTES = [
  { path: "/health", status: 200 },
  { path: "/health/ready", status: 200 },
  { path: "/openapi.json", status: 200 },
  { path: "/search?date_start=2026-10-01&date_end=2026-10-05&adults=2&nationality=USA", status: 401 },
  {
    path: "/search?date_start=2026-10-01&date_end=2026-10-05&adults=2&nationality=Atlantis",
    status: 422,
    headers: { "x-api-key": "smoke-key" },
  },
  { path: "/definitely-missing", status: 404 },
];

async function run(base) {
  const lat = [];
  let ok = 0;
  let bad = 0;
  let idx = 0;
  const started = Date.now();
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= REQUESTS) return;
      const r = ROUTES[i % ROUTES.length];
      const t0 = Date.now();
      try {
        const res = await fetch(base + r.path, { headers: r.headers || {} });
        // Drain body so the socket can be reused.
        await res.arrayBuffer().catch(() => {});
        lat.push(Date.now() - t0);
        if (res.status === r.status) ok += 1;
        else {
          bad += 1;
          console.error(`unexpected ${res.status} (want ${r.status}) for ${r.path}`);
        }
      } catch (err) {
        bad += 1;
        console.error(`request failed for ${r.path}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, worker));
  const total = (Date.now() - started) / 1000;
  lat.sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);
  console.log(
    `load-smoke: ${REQUESTS} reqs x${CONCURRENCY} conc in ${total.toFixed(1)}s ` +
      `(${(REQUESTS / total).toFixed(0)} rps) ok=${ok} bad=${bad} ` +
      `p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`
  );
  if (bad > 0) process.exitCode = 1;
}

if (BASE) {
  run(BASE).catch((e) => { console.error(e); process.exitCode = 1; });
} else {
  const server = app.listen(0);
  server.on("listening", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    run(base)
      .catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => server.close());
  });
}
