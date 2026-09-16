"use strict";

// Sell-price markup over portal net prices. MARKUP is a percent (10 = +10%).
// Applied to room net_price in API responses; the portal layer stays pure-net.
// Transfers are left untouched.

function applyMarkup(netPrice, markupPct) {
  if (netPrice === null || netPrice === undefined) return null;
  return Math.round(Number(netPrice) * (1 + Number(markupPct) / 100) * 100) / 100;
}

module.exports = { applyMarkup };
