// Plan limits are enforced by the API. Prices are display values; no subscription billing is connected.
export type PlanId = "STARTER" | "GROWTH" | "SCALE";
export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  summary: string;
  limits: { products: number | null; units: number | null; seats: number | null };
  features: string[];
}
export const PLANS: Plan[] = [
  {
    id: "STARTER",
    name: "Starter",
    price: "₹0",
    cadence: "per month",
    summary: "One shop finding out what per-unit tagging changes.",
    limits: { products: 100, units: 2000, seats: 2 },
    features: ["Tap-to-cart for every unit", "Desk and card checkout", "QR and NFC tag exports"],
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: "₹2,499",
    cadence: "per month",
    summary: "A busy floor with a team and a reorder rhythm.",
    limits: { products: 1000, units: 20000, seats: 10 },
    features: ["Everything in Starter", "Demand forecasts and reports", "Manager and staff roles"],
  },
  {
    id: "SCALE",
    name: "Scale",
    price: "Custom",
    cadence: "annual",
    summary: "High-volume retail without a ceiling on units or seats.",
    limits: { products: null, units: null, seats: null },
    features: ["Everything in Growth", "No product, unit or seat limits", "Onboarding support"],
  },
];
export const planById = (id: string) => PLANS.find((plan) => plan.id === id) ?? PLANS[0];
