import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUANTITY,
  MAX_TEXT,
  dateField,
  floatField,
  intField,
  moneyField,
  textField,
} from "../../app/lib/form";

const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

describe("intField", () => {
  it("reads whole numbers", () => {
    assert.equal(intField(form({ n: "12" }), "n"), 12);
    assert.equal(intField(form({ n: " 7 " }), "n"), 7);
    assert.equal(intField(form({ n: "3.9" }), "n"), 3);
  });
  it("falls back for blank, missing or junk input", () => {
    assert.equal(intField(form({ n: "" }), "n", 5), 5);
    assert.equal(intField(form({}), "n", 5), 5);
    assert.equal(intField(form({ n: "abc" }), "n", 5), 5);
  });
  it("caps huge numbers so the database can store them", () => {
    assert.equal(intField(form({ n: "99999999999" }), "n"), MAX_QUANTITY);
    assert.equal(intField(form({ n: "-99999999999" }), "n"), -MAX_QUANTITY);
  });
});

describe("moneyField", () => {
  it("reads prices and rounds to cents", () => {
    assert.equal(moneyField(form({ p: "72" }), "p"), 72);
    assert.equal(moneyField(form({ p: "12.345" }), "p"), 12.35);
    assert.equal(moneyField(form({ p: "$1,200.50" }), "p"), 1200.5);
  });
  it("treats blank, junk and negative prices as not set", () => {
    assert.equal(moneyField(form({ p: "" }), "p"), null);
    assert.equal(moneyField(form({ p: "free" }), "p"), null);
    assert.equal(moneyField(form({ p: "-5" }), "p"), null);
    assert.equal(moneyField(form({}), "p"), null);
  });
  it("caps absurd prices", () => {
    assert.equal(moneyField(form({ p: "1e12" }), "p"), 1_000_000);
  });
});

describe("floatField", () => {
  it("reads decimals and rejects junk", () => {
    assert.equal(floatField(form({ x: "1.5" }), "x"), 1.5);
    assert.equal(floatField(form({ x: "nope" }), "x"), null);
  });
});

describe("textField", () => {
  it("trims and treats empty as missing", () => {
    assert.equal(textField(form({ t: "  Southern Wine  " }), "t"), "Southern Wine");
    assert.equal(textField(form({ t: "   " }), "t"), null);
    assert.equal(textField(form({}), "t"), null);
  });
  it("caps very long text", () => {
    assert.equal(textField(form({ t: "x".repeat(5000) }), "t")?.length, MAX_TEXT);
  });
});

describe("dateField", () => {
  it("reads a calendar date as midday UTC", () => {
    const d = dateField(form({ d: "2026-11-05" }), "d");
    assert.ok(d instanceof Date);
    assert.equal(d.toISOString(), "2026-11-05T12:00:00.000Z");
  });
  it("treats blank as no date", () => {
    assert.equal(dateField(form({ d: "" }), "d"), null);
    assert.equal(dateField(form({}), "d"), null);
  });
  it("rejects junk, impossible and far-off dates", () => {
    for (const bad of ["next tuesday", "05/11/2026", "2026-02-31", "2026-13-01", "1999-01-01", "3026-01-01"]) {
      assert.equal(dateField(form({ d: bad }), "d"), "invalid", bad);
    }
  });
});
