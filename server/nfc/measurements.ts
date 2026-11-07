export interface FieldTrial {
  device: string;
  tag: string;
  material: string;
  carrier: "NFC" | "QR";
  outcome: string;
  browser_uri_ms: number | null;
  reservation_ms: number | null;
}
export function wilsonInterval(successes: number, trials: number): [number, number] {
  if (
    !Number.isSafeInteger(trials) ||
    trials < 1 ||
    !Number.isSafeInteger(successes) ||
    successes < 0 ||
    successes > trials
  )
    throw new Error("Invalid trial counts");
  const z = 1.959963984540054,
    p = successes / trials,
    denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator,
    radius = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function summarizeTrials(trials: FieldTrial[]) {
  const groups = new Map<string, FieldTrial[]>();
  for (const trial of trials) {
    const key = JSON.stringify([trial.device, trial.tag, trial.material, trial.carrier]);
    groups.set(key, [...(groups.get(key) ?? []), trial]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!,
      successes = group.filter((x) => x.outcome === "SUCCESS").length;
    const latency = (key: "browser_uri_ms" | "reservation_ms") => {
      const values = group
        .filter((x) => x.outcome === "SUCCESS" && x[key] !== null)
        .map((x) => x[key]!)
        .sort((a, b) => a - b);
      return {
        count: values.length,
        meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        p95Ms: values.length ? values[Math.ceil(values.length * 0.95) - 1] : null,
      };
    };
    return {
      device: first.device,
      tag: first.tag,
      material: first.material,
      carrier: first.carrier,
      trials: group.length,
      successes,
      successRate: successes / group.length,
      wilson95: wilsonInterval(successes, group.length),
      failureOutcomes: Object.fromEntries(
        [...new Set(group.filter((x) => x.outcome !== "SUCCESS").map((x) => x.outcome))].map(
          (outcome) => [outcome, group.filter((x) => x.outcome === outcome).length],
        ),
      ),
      browserUri: latency("browser_uri_ms"),
      reservation: latency("reservation_ms"),
      meets100TrialMinimum: group.length >= 100,
    };
  });
}
