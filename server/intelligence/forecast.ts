export type ForecastMethod = "mean" | "recent" | "weekday" | "intermittent";
export interface DailySale {
  date: string;
  quantity: number;
}
export interface ForecastInput {
  productId: string;
  name: string;
  available: number;
  onOrder: number;
  leadTimeDays: number;
  reviewDays: number;
  minimumStock: number;
  history: DailySale[];
}
const methods: ForecastMethod[] = ["mean", "recent", "weekday", "intermittent"];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number) => Math.round(n * 100) / 100;
function predict(history: DailySale[], horizon: number, method: ForecastMethod): number {
  const last = history.slice(-56),
    base = mean(last.map((x) => x.quantity));
  if (!last.length) return 0;
  if (method === "mean") return base * horizon;
  if (method === "recent")
    return (0.65 * mean(last.slice(-7).map((x) => x.quantity)) + 0.35 * base) * horizon;
  if (method === "intermittent") {
    let size = 0,
      interval = 1,
      gap = 1,
      seen = false;
    for (const day of last) {
      if (day.quantity > 0) {
        if (!seen) {
          size = day.quantity;
          interval = gap;
          seen = true;
        } else {
          size += 0.15 * (day.quantity - size);
          interval += 0.15 * (gap - interval);
        }
        gap = 1;
      } else gap++;
    }
    return seen ? ((0.925 * size) / interval) * horizon : 0;
  }
  let total = 0;
  const start = new Date(last[last.length - 1].date + "T00:00:00Z");
  for (let i = 1; i <= horizon; i++) {
    const weekday = new Date(start.getTime() + i * 86400000).getUTCDay();
    const matches = last.filter((d) => new Date(d.date + "T00:00:00Z").getUTCDay() === weekday);
    // Shrink weekday effects when only a few weeks are available.
    total +=
      (mean(matches.map((d) => d.quantity)) * matches.length + base * 2) / (matches.length + 2);
  }
  return total;
}
export function forecast(input: ForecastInput) {
  const history = input.history.map((d) => ({ ...d, quantity: Math.max(0, d.quantity) }));
  const horizon = Math.max(1, input.leadTimeDays + input.reviewDays);
  const validationHorizon = Math.min(horizon, 14);
  const scores = methods.map((method) => {
    const errors: number[] = [],
      actuals: number[] = [],
      residuals: number[] = [];
    for (
      let end = Math.max(14, history.length - 28 - validationHorizon);
      end + validationHorizon <= history.length;
      end++
    ) {
      const actual = history
        .slice(end, end + validationHorizon)
        .reduce((a, d) => a + d.quantity, 0);
      const estimate = predict(history.slice(0, end), validationHorizon, method);
      errors.push(Math.abs(estimate - actual));
      actuals.push(actual);
      residuals.push(actual - estimate);
    }
    const denominator = actuals.reduce((a, b) => a + b, 0);
    return {
      method,
      mae: errors.length ? round(mean(errors)) : null,
      wape: denominator ? round((errors.reduce((a, b) => a + b, 0) / denominator) * 100) : null,
      origins: errors.length,
      residuals,
    };
  });
  const ranked = scores.filter((s) => s.mae !== null).sort((a, b) => a.mae! - b.mae!);
  const selected = ranked[0] ?? scores[0];
  const expected = predict(history, horizon, selected.method);
  const residuals = [...selected.residuals].sort((a, b) => a - b);
  // Empirical historical error buffer scaled to planning horizon; not a calibrated confidence interval.
  const historicalBuffer = residuals.length
    ? Math.max(0, residuals[Math.min(residuals.length - 1, Math.floor(residuals.length * 0.9))]) *
      Math.sqrt(horizon / validationHorizon)
    : 0;
  const target = Math.max(input.minimumStock, Math.ceil(expected + historicalBuffer));
  const demand = predict(history, 7, selected.method) / 7;
  return {
    ...input,
    history: undefined,
    method: selected.method,
    observedDays: history.length,
    forecast7Days: Math.ceil(demand * 7),
    planningDemand: Math.ceil(expected),
    planningHorizonDays: horizon,
    safetyBuffer: Math.ceil(historicalBuffer),
    targetStock: target,
    reorderQuantity: Math.max(0, target - input.available - input.onOrder),
    daysOfStock: demand ? round(input.available / demand) : null,
    backtest: {
      horizonDays: validationHorizon,
      origins: selected.origins,
      mae: selected.mae,
      wape: selected.wape,
      candidates: scores.map(({ residuals: _, ...s }) => s),
    },
    dataQuality: history.length < 28 ? "SPARSE_HISTORY" : "OBSERVED_SALES",
    limitations:
      "Sales exclude returns. Stockouts and future promotions can hide demand; the error buffer is historical, not a guarantee.",
  };
}
export type Forecast = ReturnType<typeof forecast>;
