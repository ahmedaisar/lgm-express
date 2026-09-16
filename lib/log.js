"use strict";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function level() {
  // Read lazily so tests can set LOG_LEVEL before first log call.
  const name = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[name] ?? LEVELS.info;
}

function fmt(msg, args) {
  let i = 0;
  return String(msg).replace(/%[sdj]/g, (m) => {
    const a = args[i++];
    if (m === "%j") {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  });
}

function logAt(name, msg, ...args) {
  if ((LEVELS[name] ?? 20) < level()) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${name.toUpperCase()} ${fmt(msg, args)}`;
  // eslint-disable-next-line no-console
  console[name === "debug" ? "log" : name](line);
}

module.exports = {
  debug: (...a) => logAt("debug", ...a),
  info: (...a) => logAt("info", ...a),
  warn: (...a) => logAt("warn", ...a),
  error: (...a) => logAt("error", ...a),
};
