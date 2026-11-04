export interface DemandInput {
  productId: string;
  name: string;
  available: number;
  sales28: number;
  sales7: number;
  observedDays: number;
}

export function forecastDemand(input: DemandInput) {
  const observedDays = Math.max(1, Math.min(28, input.observedDays));
  const dailyBaseline = input.sales28 / observedDays;
  const recentDays = Math.min(7, observedDays);
  const dailyRecent = input.sales7 / recentDays;
  const dailyDemand = 0.4 * dailyBaseline + 0.6 * dailyRecent;
  const forecast7Days = Math.ceil(dailyDemand * 7);
  const safetyStock = Math.ceil(1.65 * Math.sqrt(dailyDemand * 7));
  return {
    productId: input.productId,
    name: input.name,
    available: input.available,
    dailyDemand: Math.round(dailyDemand * 100) / 100,
    forecast7Days,
    reorderQuantity: Math.max(0, forecast7Days + safetyStock - input.available),
    daysOfStock: dailyDemand > 0 ? Math.round((input.available / dailyDemand) * 10) / 10 : null,
    confidence:
      observedDays >= 21 && input.sales28 >= 30
        ? ("high" as const)
        : observedDays >= 7 && input.sales28 >= 7
          ? ("medium" as const)
          : ("low" as const),
  };
}

export function demandShift(input: DemandInput): number | null {
  const previousDays = Math.min(21, input.observedDays - 7);
  if (previousDays < 7 || input.sales28 - input.sales7 < 3) return null;
  const previousDaily = (input.sales28 - input.sales7) / previousDays;
  return Math.round(((input.sales7 / 7 - previousDaily) / previousDaily) * 100);
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(cents / 100);
}
