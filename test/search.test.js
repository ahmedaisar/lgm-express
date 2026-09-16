"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  toPortalDate,
  travellersAges,
  normalizeAvailability,
  parseSearchFragment,
} = require("../lib/portal/search");

describe("search portal helpers", () => {
  it("toPortalDate converts ISO to DD.MM.YYYY", () => {
    assert.equal(toPortalDate("2026-10-01"), "01.10.2026");
    assert.throws(() => toPortalDate("01.10.2026"), /YYYY-MM-DD/);
  });

  it("travellersAges is dash-joined, 25 per adult", () => {
    assert.equal(travellersAges(2, null), "25-25");
    assert.equal(travellersAges(2, [6, 10]), "25-25-6-10");
  });

  it("normalizeAvailability maps RQ, keeps the rest distinct", () => {
    assert.equal(normalizeAvailability("RQ"), "on_request");
    assert.equal(normalizeAvailability("On Request"), "on_request");
    assert.equal(normalizeAvailability(""), "unknown");
    assert.equal(normalizeAvailability("XX"), "XX");
  });

  it("parseSearchFragment reads real-shaped rows", () => {
    const qq = JSON.stringify({
      price: "1200.00", roomType: "Beach Villa", boardType: "HB",
      currency: "USD", region: "Male Atoll",
    });
    const html = `
      <tr><td class='parts'><input type='hidden' class='part-number' value='1'>
      <input type='hidden' class='parts-total' value='3'></td></tr>
      <tr class="hotel-list-item-wrapper" data-country-id="228" data-hotel-id="11">
        <td>30.09.2026</td><td>7</td>
        <td><a class="hotel-card__title-link" href="/hotel/sun-resort/?x=1">
          <span class="hotel-card__title-link-td-name">Sun Resort 5* Deluxe</span></a><br>
          <a class="hotel-card__location-link--resort">Male Atoll</a></td>
        <td>Garden Room</td>
        <td><span class="meal-type-and-vehicle-icons">BB</span></td>
        <td>RQ</td>
        <td><span class="hotel-card__price hotel-item-price" data-price="1200.0000">1 200</span>
          <span class="hotel-card__price-currency">$</span></td>
        <td><span class="qq-btn-place" data-value='${qq}'></span></td>
      </tr>
      <tr><td>header without price is skipped</td></tr>`;
    const { rows, partNumber, partsTotal } = parseSearchFragment(html);
    assert.equal(partNumber, 1);
    assert.equal(partsTotal, 3);
    assert.equal(rows.length, 1);
    const [first] = rows;
    assert.equal(first.hotel_name, "Sun Resort");
    assert.equal(first.star_rating, 5);
    assert.equal(first.hotel_slug, "sun-resort");
    assert.equal(first.hotel_id, "11");
    assert.equal(first.room_type, "Beach Villa");
    assert.equal(first.meal_plan, "HB");
    assert.equal(first.availability, "on_request");
    assert.equal(first.net_price, 1200.0);
    assert.equal(first.currency, "USD");
  });
});
