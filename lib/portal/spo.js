"use strict";

const cheerio = require("cheerio");

function parseSpoTemplate(html) {
  const $ = cheerio.load(html || "");
  const offers = [];
  $("table.table-striped").each((_, table) => {
    const $table = $(table);
    const $titleCell = $table.find("h4").first();
    const rawTitle = $titleCell
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*\(Код:\s*[^)]+\)\s*$/, "")
      .trim();
    if (!rawTitle) return;
    const discountText = $titleCell.find(".text-success").first().text();
    const discountMatch = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(discountText || "");
    const discountPercent = discountMatch ? parseFloat(discountMatch[1]) : null;

    const rows = {};
    $table.find("tr").each((_, tr) => {
      const $tds = $(tr).find("td");
      if ($tds.length < 2) return;
      const label = $tds.eq(0).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
      const value = $tds.eq(1).text().replace(/\s+/g, " ").trim();
      if (label) rows[label] = value;
    });

    const $roomsTd = $table
      .find("tr")
      .filter((_, tr) => /Комнаты/.test($(tr).find("td").first().text()))
      .find("td")
      .eq(1);
    const rooms = $roomsTd
      .text()
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((s) => s.replace(/:\s*\d+%\s*$/, "").trim())
      .filter(Boolean);

    const $extraBedTd = $table
      .find("tr")
      .filter((_, tr) => /Дополнительная кровать/.test($(tr).find("td").first().text()))
      .find("td")
      .eq(1);
    const extraBedRooms = $extraBedTd
      .find("li")
      .toArray()
      .map((li) => $(li).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const typeText = $table
      .find("h4 small")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    offers.push({
      name: rawTitle,
      discount_percent: discountPercent,
      type: typeText || null,
      stay_period: rows["Размещение"] || null,
      booking_period: rows["Период бронирования"] || null,
      rooms: rooms.length ? rooms : null,
      extra_bed_rooms: extraBedRooms.length ? extraBedRooms : null,
    });
  });
  return offers;
}

module.exports = { parseSpoTemplate };
