import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { ApiError } from "../errors.js";
import type { CatalogItem } from "./catalog.js";
export interface ExtractedLine {
  source: string;
  productId: string | null;
  description: string;
  quantity: number | null;
  unitCostCents: number | null;
  confidence: "EXACT_SKU" | "NAME_MATCH" | "UNMATCHED";
  warnings: string[];
}
export function extractInvoice(text: string, products: CatalogItem[]) {
  const lines: ExtractedLine[] = [];
  for (const raw of text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (lines.length >= 100) break;
    if (
      /^(?:invoice|supplier|date|description|product[,\t;]|sku[,\t;]|subtotal|total|tax|gst|amount|bill|address|phone)/i.test(
        raw,
      )
    )
      continue;
    const costPattern =
      "(?:₹|Rs\\.?|INR)?\\s*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,2})?";
    const match =
      new RegExp(
        '^(.*?)[,;|\\t]\\s*([0-9]+)\\s*[,;|\\t]\\s*["\\x27]?(' + costPattern + ')["\\x27]?$',
        "i",
      ).exec(raw) ?? new RegExp("^(.*?)\\s+([0-9]+)\\s+(" + costPattern + ")$", "i").exec(raw);
    if (!match) continue;
    const description = match[1].trim().replace(/^["']|["']$/g, ""),
      quantity = Number(match[2]),
      cost = Math.round(
        Number(match[3].replace(/^(?:₹|Rs\.?|INR)\s*/i, "").replace(/,/g, "")) * 100,
      );
    if (!description) continue;
    const lower = description.toLowerCase();
    const skuMatches = products.filter((p) =>
      lower.split(/[^\p{L}\p{N}_-]+/u).includes(p.sku.toLowerCase()),
    );
    const names = products.filter(
      (p) => lower === p.name.toLowerCase() || lower.includes(p.name.toLowerCase()),
    );
    const matches = skuMatches.length ? skuMatches : names;
    const product = matches.length === 1 ? matches[0] : null;
    const warnings: string[] = [];
    if (!product)
      warnings.push(
        matches.length > 1
          ? "Ambiguous product: choose the correct SKU."
          : "Choose a catalog product.",
      );
    if (quantity < 1 || quantity > 10000) warnings.push("Quantity must be between 1 and 10,000.");
    if (!Number.isSafeInteger(cost) || cost > 100_000_000)
      warnings.push("Unit cost is outside supported bounds.");
    lines.push({
      source: raw,
      productId: product?.id ?? null,
      description,
      quantity: quantity >= 1 && quantity <= 10000 ? quantity : null,
      unitCostCents: cost <= 100_000_000 ? cost : null,
      confidence: product ? (skuMatches.length ? "EXACT_SKU" : "NAME_MATCH") : "UNMATCHED",
      warnings,
    });
  }
  return {
    invoiceNumber:
      /(?:invoice|bill)\s*(?:no\.?|number|#|:)\s*[:#]?\s*([A-Za-z0-9/_-]+)/i.exec(text)?.[1] ?? "",
    lines,
    warnings: lines.length
      ? [
          "Review every quantity and unit cost against the original. Tax, totals, discounts and pack-size conversions require manual review.",
        ]
      : ["No unambiguous quantity/unit-cost rows found. Enter the receiving draft manually."],
    format: "Description or SKU, quantity, unit cost (INR)",
  };
}
let active = 0;
export async function readInvoiceFile(buffer: Buffer, mime: string) {
  if (active >= 2)
    throw new ApiError(503, "Two invoice extractions are already running. Try again shortly.");
  const pdf = buffer.subarray(0, 5).toString() === "%PDF-",
    png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!pdf && !png && !jpeg && (mime.startsWith("text/") || mime === "application/csv")) {
    if (buffer.includes(0)) throw new ApiError(400, "Upload a UTF-8 text or CSV invoice.");
    return { text: buffer.toString("utf8").slice(0, 100000), engine: "TEXT" };
  }
  if (!pdf && !png && !jpeg)
    throw new ApiError(400, "Supported invoices: UTF-8 text/CSV, PDF, PNG or JPEG.");
  if (png || jpeg) {
    const dimensions = imageDimensions(buffer);
    if (
      !dimensions ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width * dimensions.height > 16000000
    )
      throw new ApiError(400, "Images must have valid dimensions and be at most 16 megapixels.");
  }
  active++;
  const compiledWorker = new URL("./invoice-worker.js", import.meta.url);
  const compiled = existsSync(compiledWorker);
  try {
    return await new Promise<{ text: string; engine: string }>((resolveResult, reject) => {
      const worker = new Worker(
        compiled ? compiledWorker : new URL("./invoice-worker.ts", import.meta.url),
        {
          execArgv: compiled ? [] : ["--import", "tsx"],
          workerData: {
            buffer,
            pdf,
            cache: resolve(process.env.OCR_MODEL_CACHE || ".cache/ocr"),
            download: process.env.AI_ALLOW_MODEL_DOWNLOAD === "true",
          },
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new ApiError(
            422,
            "Extraction exceeded 60 seconds. Use a smaller invoice or paste its text.",
          ),
        );
      }, 60000);
      worker.once("message", (result: { text: string; engine: string; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (result.error) reject(new ApiError(422, result.error));
        else resolveResult(result);
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(new ApiError(422, "The invoice could not be decoded."));
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(
            new ApiError(422, "Invoice extraction stopped. Try a smaller file or text entry."),
          );
      });
    });
  } finally {
    active--;
  }
}

export function imageDimensions(data: Buffer): { width: number; height: number } | null {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString("ascii", 12, 16) === "IHDR"
  )
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data[0] !== 255 || data[1] !== 216) return null;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 255) return null;
    while (data[offset] === 255) offset++;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) return null;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      if (length < 8) return null;
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}
