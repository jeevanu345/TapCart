import { resolve } from "node:path";
export interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  priceCents: number;
  available: number;
}
const synonyms: Record<string, string> = {
  kaapi: "coffee",
  cappuccino: "coffee",
  espresso: "coffee",
  latte: "coffee",
  कॉफी: "coffee",
  ಕಾಫಿ: "coffee",
  दूध: "milk",
  ಹಾಲು: "milk",
  चाय: "tea",
  ಚಹಾ: "tea",
  rice: "rice",
  चावल: "rice",
  ಅಕ್ಕಿ: "rice",
  sugar: "sugar",
  चीनी: "sugar",
};
export function parseSearch(query: string) {
  let q = query
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\d[\d,]*/g, (value) =>
      /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})$/.test(value)
        ? value.replace(/,/g, "")
        : value,
    );
  let maxPriceCents: number | null = null,
    minPriceCents: number | null = null;
  const amount = "(?:₹|rs\\.?|inr)?\\s*([0-9]+(?:\\.[0-9]{1,2})?)";
  const max = new RegExp("(?:under|below|less than|up to|तक|ಒಳಗೆ)\\s*" + amount, "i").exec(q);
  const min = new RegExp("(?:over|above|more than)\\s*" + amount, "i").exec(q);
  if (max) {
    maxPriceCents = Math.round(Number(max[1]) * 100);
    q = q.replace(max[0], "");
  }
  if (min) {
    minPriceCents = Math.round(Number(min[1]) * 100);
    q = q.replace(min[0], "");
  }
  const words = q
    .split(/[\s,;!?]+/u)
    .filter(Boolean)
    .map((w) => synonyms[w] ?? w)
    .filter(
      (w) => !["a", "the", "some", "find", "show", "me", "please", "buy", "want", "i"].includes(w),
    );
  return { text: words.join(" "), maxPriceCents, minPriceCents };
}
type Embed = (texts: string[]) => Promise<number[][]>;
let embedder: Promise<Embed> | undefined;
export async function localEmbeddings(texts: string[]): Promise<number[][]> {
  if (!embedder)
    embedder = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = resolve(process.env.AI_MODEL_CACHE || ".cache/models");
      // Network downloads must be explicitly enabled by the operator/warmup command.
      env.allowRemoteModels = process.env.AI_ALLOW_MODEL_DOWNLOAD === "true";
      let running = false;
      const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "q8",
      });
      return async (inputs: string[]) => {
        if (running) throw new Error("Local inference is busy.");
        running = true;
        try {
          const vectors: number[][] = [];
          for (let offset = 0; offset < inputs.length; offset += 16) {
            const tensor = await extractor(inputs.slice(offset, offset + 16), {
              pooling: "mean",
              normalize: true,
            });
            vectors.push(...(tensor.tolist() as number[][]));
          }
          return vectors;
        } finally {
          running = false;
        }
      };
    })().catch((e) => {
      embedder = undefined;
      throw e;
    });
  return (await embedder)(texts);
}
const cache = new Map<string, { key: string; vectors: Promise<number[][]> }>();
export async function searchCatalog(
  items: CatalogItem[],
  query: string,
  scope: string,
  embed: Embed = localEmbeddings,
) {
  const filters = parseSearch(query),
    eligible = items.filter(
      (p) =>
        (filters.maxPriceCents === null || p.priceCents <= filters.maxPriceCents) &&
        (filters.minPriceCents === null || p.priceCents >= filters.minPriceCents),
    );
  let mode: "semantic-local" | "lexical-local" = "lexical-local";
  let scores: number[] = [];
  if (filters.text && eligible.length) {
    try {
      // Cache by full catalog, independent of a shopper's price filter.
      const key = JSON.stringify(
        items.map((p) => [p.id, p.name, p.description, p.category, p.sku]),
      );
      let cached = cache.get(scope);
      if (!cached || cached.key !== key) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value!);
        cached = {
          key,
          vectors: embed(
            items.map((p) => `${p.name}. ${p.category}. ${p.description}. SKU ${p.sku}`),
          ),
        };
        cache.set(scope, cached);
        cached.vectors.catch(() => {
          if (cache.get(scope) === cached) cache.delete(scope);
        });
      }
      const vectors = await cached.vectors;
      const [vector] = await embed([filters.text]);
      const indices = new Map(items.map((p, i) => [p.id, i]));
      scores = eligible.map((p) =>
        vectors[indices.get(p.id)!].reduce((a, n, i) => a + n * vector[i], 0),
      );
      mode = "semantic-local";
    } catch {
      /* Search remains useful when a local model is absent or busy. UI identifies this mode. */
    }
  }
  if (mode === "lexical-local")
    scores = eligible.map((p) => {
      const name = `${p.name} ${p.category}`.toLowerCase(),
        all = `${name} ${p.sku} ${p.description}`.toLowerCase();
      return filters.text
        .split(" ")
        .filter(Boolean)
        .reduce((s, w) => s + (name.includes(w) ? 2 : all.includes(w) ? 1 : 0), 0);
    });
  const results = eligible
    .map((p, i) => ({ ...p, score: Math.round(scores[i] * 1000) / 1000 }))
    .filter((p) => !filters.text || (mode === "semantic-local" ? p.score >= 0.2 : p.score > 0))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 30);
  return {
    mode,
    filters,
    results,
    model: mode === "semantic-local" ? "all-MiniLM-L6-v2 (local CPU)" : null,
  };
}
