import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
process.env.AI_ALLOW_MODEL_DOWNLOAD = "true";
const { localEmbeddings } = await import("../intelligence/catalog.js");
const vectors = await localEmbeddings(["Coffee beans for espresso", "Fresh dairy milk"]);
console.log(
  `Local semantic model ready: ${vectors.length} × ${vectors[0].length} normalized embeddings.`,
);
const { createWorker } = await import("tesseract.js");
const cachePath = resolve(process.env.OCR_MODEL_CACHE || ".cache/ocr");
await mkdir(cachePath, { recursive: true });
const worker = await createWorker("eng", 1, { cachePath });
await worker.terminate();
console.log("Local English OCR model ready. Inference does not require external API keys.");
