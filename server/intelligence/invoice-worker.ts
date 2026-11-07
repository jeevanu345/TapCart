import { parentPort, workerData } from "node:worker_threads";
import { createWorker, type Worker as OcrWorker } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
interface Input {
  buffer: Uint8Array;
  pdf: boolean;
  cache: string;
  download: boolean;
}
const input = workerData as Input;
async function extract() {
  let ocr: OcrWorker | undefined;
  async function recognize(buffer: Buffer) {
    ocr ??= await createWorker("eng", 1, {
      cachePath: input.cache,
      ...(input.download ? {} : { langPath: input.cache, gzip: false }),
    });
    return (await ocr.recognize(buffer)).data.text;
  }
  try {
    if (!input.pdf) {
      const buffer = Buffer.from(input.buffer),
        image = await loadImage(buffer);
      if (image.width * image.height > 16000000)
        throw Error("Images must be at most 16 megapixels.");
      return { text: (await recognize(buffer)).slice(0, 100000), engine: "OCR" };
    }
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(input.buffer),
      useSystemFonts: true,
    });
    const doc = await loading.promise;
    try {
      if (doc.numPages > 5) throw Error("Invoices are limited to five pages.");
      let text = "",
        engine = "PDF_TEXT";
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber),
          content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items)
          if ("str" in item) pageText += item.str + (item.hasEOL ? "\n" : "  ");
        if (pageText.trim().length < 20) {
          const initial = page.getViewport({ scale: 1 }),
            scale = Math.min(2, 2400 / Math.max(initial.width, initial.height)),
            viewport = page.getViewport({ scale });
          if (viewport.width * viewport.height > 8000000) throw Error("PDF page is too large.");
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          // PDF.js uses DOM interfaces; the supported native Node canvas implements its rendering surface.
          await page.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          pageText = await recognize(canvas.toBuffer("image/png"));
          engine = "PDF_OCR";
        }
        text += pageText + "\n";
        if (text.length > 100000) throw Error("PDF text exceeds the extraction limit.");
        page.cleanup();
      }
      return { text, engine };
    } finally {
      await loading.destroy();
    }
  } finally {
    if (ocr) await ocr.terminate();
  }
}
void extract()
  .then((result) => parentPort?.postMessage(result))
  .catch(() =>
    parentPort?.postMessage({
      error:
        "Extraction failed. Check the document format and local OCR model installation; use text entry if needed.",
    }),
  );
