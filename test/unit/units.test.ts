import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCasesAndBottles,
  formatMoney,
  formatUnits,
  lineCost,
  lineOrderedUnits,
  splitUnits,
  suggestedCases,
  toUnits,
} from "../../app/lib/units";

describe("toUnits", () => {
  it("converts cases plus loose bottles to bottles", () => {
    assert.equal(toUnits(2, 3, 12), 27);
    assert.equal(toUnits(0, 5, 6), 5);
    assert.equal(toUnits(3, 0, 24), 72);
  });
  it("never goes negative and ignores fractions", () => {
    assert.equal(toUnits(-2, -1, 12), 0);
    assert.equal(toUnits(1.9, 2.7, 12), 14);
  });
  it("treats a missing or zero case size as single bottles", () => {
    assert.equal(toUnits(2, 1, 0), 3);
    assert.equal(toUnits(2, 1, Number.NaN), 3);
  });
});

describe("splitUnits", () => {
  it("splits bottles into full cases and leftovers", () => {
    assert.deepEqual(splitUnits(27, 12), { cases: 2, loose: 3 });
    assert.deepEqual(splitUnits(12, 12), { cases: 1, loose: 0 });
    assert.deepEqual(splitUnits(5, 6), { cases: 0, loose: 5 });
  });
  it("round-trips with toUnits for every case size", () => {
    for (const size of [1, 6, 12, 24]) {
      for (let units = 0; units <= 60; units++) {
        const { cases, loose } = splitUnits(units, size);
        assert.equal(toUnits(cases, loose, size), units, `size ${size}, units ${units}`);
        assert.ok(loose < size || size === 1);
      }
    }
  });
  it("clamps negative stock to zero", () => {
    assert.deepEqual(splitUnits(-4, 12), { cases: 0, loose: 0 });
  });
});

describe("formatUnits", () => {
  it("shows cases and bottles", () => {
    assert.equal(formatUnits(27, 12), "2 cs + 3 btl");
    assert.equal(formatUnits(24, 12), "2 cs");
    assert.equal(formatUnits(5, 12), "5 btl");
    assert.equal(formatUnits(0, 12), "0");
  });
  it("shows plain bottles when items aren't sold by the case", () => {
    assert.equal(formatUnits(7, 1), "7 btl");
  });
});

describe("formatCasesAndBottles", () => {
  it("formats order totals", () => {
    assert.equal(formatCasesAndBottles(2, 3), "2 cs + 3 btl");
    assert.equal(formatCasesAndBottles(5, 0), "5 cs");
    assert.equal(formatCasesAndBottles(0, 4), "4 btl");
    assert.equal(formatCasesAndBottles(0, 0), "0 cs");
  });
});

describe("suggestedCases", () => {
  const base = { available: 0, incoming: 0, reorderPoint: 24, parLevel: 36, caseSize: 6 };

  it("orders nothing above the reorder point", () => {
    assert.equal(suggestedCases({ ...base, available: 25 }), 0);
  });
  it("orders at exactly the reorder point", () => {
    assert.equal(suggestedCases({ ...base, available: 24 }), 2); // 12 short -> 2 cases of 6
  });
  it("rounds up to whole cases to reach par", () => {
    assert.equal(suggestedCases({ ...base, available: 28, reorderPoint: 30 }), 2); // 8 short
    assert.equal(suggestedCases({ ...base, available: 20, caseSize: 12, parLevel: 36 }), 2); // 16 short
  });
  it("counts stock already on order", () => {
    assert.equal(suggestedCases({ ...base, available: 20, incoming: 12 }), 0);
    assert.equal(suggestedCases({ ...base, available: 10, incoming: 12 }), 3); // 22 -> 14 short
  });
  it("treats oversold (negative) stock as a bigger shortfall", () => {
    assert.equal(suggestedCases({ ...base, available: -6 }), 7); // 42 short
  });
  it("orders past the reorder point when par is missing or too low", () => {
    assert.equal(suggestedCases({ ...base, available: 10, parLevel: 0 }), 3); // target 25 -> 15 short
    assert.equal(suggestedCases({ ...base, available: 24, parLevel: 10 }), 1); // target 25 -> 1 short
  });
  it("does nothing when no reorder settings are set", () => {
    assert.equal(suggestedCases({ ...base, reorderPoint: 0, parLevel: 0 }), 0);
  });
  it("handles a case size of 1", () => {
    assert.equal(suggestedCases({ ...base, available: 20, caseSize: 1 }), 16);
  });
});

describe("line maths", () => {
  const line = { casesOrdered: 2, looseOrdered: 3, caseSize: 12, costPerCase: 120 };

  it("counts ordered bottles", () => {
    assert.equal(lineOrderedUnits(line), 27);
  });
  it("prices loose bottles pro rata", () => {
    assert.equal(lineCost(line), 270); // 2 x 120 + 3 x 10
    assert.equal(lineCost({ ...line, casesOrdered: 1, looseOrdered: 2, caseSize: 6, costPerCase: 72 }), 96);
  });
  it("rounds to cents", () => {
    assert.equal(lineCost({ casesOrdered: 0, looseOrdered: 1, caseSize: 3, costPerCase: 10 }), 3.33);
  });
  it("has no cost when the case price is unknown", () => {
    assert.equal(lineCost({ ...line, costPerCase: null }), null);
  });
});

describe("formatMoney", () => {
  it("formats dollars", () => {
    assert.equal(formatMoney(96), "$96.00");
    assert.equal(formatMoney(3.333), "$3.33");
  });
  it("shows a dash when unknown", () => {
    assert.equal(formatMoney(null), "—");
    assert.equal(formatMoney(undefined), "—");
    assert.equal(formatMoney(Number.NaN), "—");
  });
});
