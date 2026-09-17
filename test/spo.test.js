"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { parseSpoTemplate } = require("../lib/portal/spo");

const SPO_HTML = `
<table class="table table-bordered table-striped">
  <tbody>
    <tr><td colspan="2"><h4>Shoulder Season Offer 20% (Код: Shoulder Season Offer 20%) <span class="text-success">-20%</span></h4></td></tr>
    <tr><td>Размещение:</td><td>01 Окт 2026 - 22 Дек 2026</td></tr>
    <tr><td>Период бронирования:</td><td>20 Янв 2026 - 30 Сен 2026</td></tr>
    <tr><td>Комнаты:</td><td>Overwater Villa with Pool:<span class="text-success">20%</span>, Beach Villa with Pool:<span class="text-success">20%</span>,</td></tr>
  </tbody>
</table>
<table class="table table-bordered table-striped">
  <tbody>
    <tr><td colspan="2"><h4>HONEYMOON AND ANNIVERSARY BENEFITS <br><small>Text bonus</small></h4></td></tr>
    <tr><td>Размещение:</td><td>20 Янв 2026 - 22 Дек 2026</td></tr>
    <tr><td>Период бронирования:</td><td>20 Янв 2026 - 22 Дек 2026</td></tr>
    <tr><td>Комнаты: </td><td>Overwater Villa with Pool, Beach Villa with Pool</td></tr>
    <tr><td>Ограничения</td><td>Minstay strict=4 ; Guests=Honeymooner\`s Guests</td></tr>
  </tbody>
</table>`;

describe("spo parsing", () => {
  it("reads discount, stay/booking periods, rooms and type", () => {
    const offers = parseSpoTemplate(SPO_HTML);
    assert.equal(offers.length, 2);
    const [first, second] = offers;
    assert.equal(first.name, "Shoulder Season Offer 20%");
    assert.equal(first.discount_percent, -20);
    assert.equal(first.stay_period, "01 Окт 2026 - 22 Дек 2026");
    assert.equal(first.booking_period, "20 Янв 2026 - 30 Сен 2026");
    assert.deepEqual(first.rooms, ["Overwater Villa with Pool", "Beach Villa with Pool"]);
    assert.equal(second.type, "Text bonus");
    assert.equal(second.discount_percent, null);
  });
});
