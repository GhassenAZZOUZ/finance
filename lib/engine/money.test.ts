import { describe, expect, it } from "vitest";
import { eurosToCents, roundHalfAwayFromZero, sumCents } from "./money";
import { addMonths, compareMonths, fromMonthIndex, isYearMonth, monthIndex, monthsBetween } from "./months";

describe("roundHalfAwayFromZero (Excel ROUND semantics)", () => {
  it("rounds exact halves away from zero", () => {
    expect(roundHalfAwayFromZero(37.5)).toBe(38);
    expect(roundHalfAwayFromZero(-37.5)).toBe(-38);
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
  });

  it("snaps binary noise to 15 significant digits before rounding", () => {
    // 636.19 € × 50 % in cents: the double is 31809.499999999996, Excel sees 31809.5.
    expect(roundHalfAwayFromZero(63619 * 0.5 - 1e-12)).toBe(31810);
    expect(roundHalfAwayFromZero(1.005 * 100)).toBe(101);
  });

  it("rounds non-halves normally and never returns -0", () => {
    expect(roundHalfAwayFromZero(2.4999)).toBe(2);
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true);
  });

  it("rejects non-finite numbers", () => {
    expect(() => roundHalfAwayFromZero(Number.NaN)).toThrow(RangeError);
  });

  it("converts euros to cents and sums", () => {
    expect(eurosToCents(245.3)).toBe(24530);
    expect(eurosToCents(0.1 + 0.2)).toBe(30);
    expect(sumCents([24530, 7240, 5])).toBe(31775);
  });
});

describe("YYYY-MM months", () => {
  it("adds months across years", () => {
    expect(addMonths("2027-11", 3)).toBe("2028-02");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2027-01", 299)).toBe("2051-12");
  });

  it("counts and compares months", () => {
    expect(monthsBetween("2027-01", "2027-06")).toBe(5);
    expect(monthsBetween("2027-01", "2026-10")).toBe(-3);
    expect(compareMonths("2027-06", "2027-06")).toBe(0);
    expect(fromMonthIndex(monthIndex("2031-09"))).toBe("2031-09");
  });

  it("validates the format", () => {
    expect(isYearMonth("2027-01")).toBe(true);
    expect(isYearMonth("2027-13")).toBe(false);
    expect(isYearMonth("2027-1")).toBe(false);
    expect(() => monthIndex("2027/01")).toThrow(RangeError);
  });
});
