import { describe, expect, it } from "vitest";
import { demandShift, forecastDemand } from "./intelligence.js";

describe("retail intelligence with sparse and changing demand", () => {
  it("does not invent demand for a new product without observations", () => {
    const result = forecastDemand({
      productId: "p",
      name: "New",
      available: 0,
      sales28: 0,
      sales7: 0,
      observedDays: 0,
    });
    expect(result.forecast7Days).toBe(0);
    expect(result.reorderQuantity).toBe(0);
    expect(result.daysOfStock).toBeNull();
    expect(result.confidence).toBe("low");
  });
  it("responds to recent demand and subtracts existing inventory", () => {
    const result = forecastDemand({
      productId: "p",
      name: "Milk",
      available: 4,
      sales28: 56,
      sales7: 28,
      observedDays: 28,
    });
    expect(result.dailyDemand).toBe(3.2);
    expect(result.forecast7Days).toBe(23);
    expect(result.reorderQuantity).toBeGreaterThan(19);
    expect(result.daysOfStock).toBe(1.3);
    expect(result.confidence).toBe("high");
  });
  it("never suggests negative replenishment", () => {
    expect(
      forecastDemand({
        productId: "p",
        name: "Tea",
        available: 1000,
        sales28: 28,
        sales7: 7,
        observedDays: 28,
      }).reorderQuantity,
    ).toBe(0);
  });
  it("suppresses sparse comparisons and detects sustained shifts", () => {
    expect(
      demandShift({
        productId: "p",
        name: "x",
        available: 0,
        sales28: 1,
        sales7: 1,
        observedDays: 2,
      }),
    ).toBeNull();
    expect(
      demandShift({
        productId: "p",
        name: "x",
        available: 0,
        sales28: 42,
        sales7: 21,
        observedDays: 28,
      }),
    ).toBe(200);
  });
});
