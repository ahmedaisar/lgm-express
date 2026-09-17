"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { loadMapping, resolveNationality } = require("../lib/data/nationality");
const { parseHotelPage, parseHotelTemplate } = require("../lib/portal/hotel");
const { parseChildAges } = require("../lib/api/common");

describe("nationality mapping", () => {
  it("resolves ISO3, name, and numeric passthrough", () => {
    const mapping = loadMapping();
    assert.equal(resolveNationality("USA", mapping), "413");
    assert.equal(resolveNationality("maldives", mapping), "228");
    assert.equal(resolveNationality("228", mapping), "228");
    assert.throws(() => resolveNationality("Atlantis", mapping), /Unknown nationality/);
  });
});

describe("hotel template parsing", () => {
  const PAGE = `<html><body><h1>Sun Resort</h1>
    <form><input type="hidden" name="csrfmiddlewaretoken" value="pagetok"></form>
    <script>var supplier_company_id = '10638', hotel_id = '11', rate_code_id = '180',
    hotel_supplier_id = '1794155',
    room_ajax_url = "/hotel/book/load-hotel-data/sun-resort/",
    load_bonuses_url = "/hotel/book/load-bonuses/";</script>
    </body></html>`;

  const TEMPLATE = `
    <div id='rooms-wrapper'>
      <div class="row" data-role="room" data-calculation-source="">
        <div class="h2 room-title">Beach Villa</div>
        <span class="room-occupancy-data">2A</span>
        <div class="allotments-wrapper" data-allotments-status="On Request"></div>
        <div class="room-features hidden"><ul><li>Pool</li></ul></div>
        <div class="cancellation-policies-json hidden">[{"free_until": "7 days"}]</div>
        <h4 class="hotel-book-ajax__meal-title">BB (Bed and Breakfast)</h4>
        <div class="calculation-wrapper"><button class="btn select-room-and-meal"
          data-hotel-id="11" data-currency-for-view="USD" data-price-for-view="1200">x</button></div>
      </div>
      <div id='hotel-book-transfer'>
        <div class="col-xs-12 select-transfer" data-price-for-view="150.00" data-currency-for-view="USD">
          <form>
            <input name="transfer_uid" type="hidden" value="1|arrival"/>
            <input name="transfer_vehicle" type="hidden" value="Speedboat"/>
            <input name="transfer_price" type="hidden" value="150.00"/>
            <input name="transfer_price_currency" type="hidden" value="USD"/>
            <input name="transfer_payment_type" type="hidden" value="2 pax"/>
          </form>
        </div>
      </div>
    </div>`;

  it("parseHotelPage reads booking context", () => {
    const ctx = parseHotelPage(PAGE, "sun-resort");
    assert.equal(ctx.hotel_id, "11");
    assert.equal(ctx.supplier_company_id, "10638");
    assert.equal(ctx.rate_code_id, "180");
    assert.equal(ctx.room_ajax_url, "/hotel/book/load-hotel-data/sun-resort/");
    assert.equal(ctx.load_bonuses_url, "/hotel/book/load-bonuses/");
    assert.equal(ctx.csrf_token, "pagetok");
    assert.equal(ctx.hotel_name, "Sun Resort");
  });

  it("parseHotelTemplate reads rooms and transfers", () => {
    const { rooms, transfers } = parseHotelTemplate(TEMPLATE);
    assert.equal(rooms.length, 1);
    const { cancellation_policy, room_features, hotel_supplier_id, ...rest } = rooms[0];
    assert.deepEqual(rest, {
      room_name: "Beach Villa",
      meal_plan: "BB",
      net_price: 1200,
      currency: "USD",
      occupancy: "2A",
      availability: "on_request",
      calculation_method: null,
    });
    assert.deepEqual(cancellation_policy, [{ free_until: "7 days" }]);
    assert.deepEqual(room_features, ["Pool"]);
    assert.equal(transfers.length, 1);
    assert.deepEqual(transfers[0], {
      vehicle_type: "Speedboat",
      direction: "arrival",
      pax: "2 pax",
      net_price: 150,
      currency: "USD",
    });
  });
});

describe("child ages", () => {
  it("requires ages when childs>0", () => {
    assert.equal(parseChildAges(null, 0), null);
    assert.deepEqual(parseChildAges("6,10", 2), [6, 10]);
    assert.throws(() => parseChildAges(null, 1), /child_ages is required/);
    assert.throws(() => parseChildAges("6,10", 1), /entries but childs/);
  });
});
