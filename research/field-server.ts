import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, open, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { measurementColumns, measurementCsvRow, validateMeasurement } from "./field-analysis.js";

const port = Number(process.env.FIELD_PORT ?? 8088);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FIELD_PORT");
const output = resolve(process.env.FIELD_OUTPUT ?? "field-measurements.csv");
const token = randomBytes(32).toString("hex");
const origin = `http://127.0.0.1:${port}`;
try {
  const handle = await open(output, "wx", 0o600);
  await handle.writeFile(measurementColumns.join(",") + "\n");
  await handle.close();
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  const existing = await readFile(output, "utf8");
  if (existing.split(/\r?\n/)[0] !== measurementColumns.join(","))
    throw new Error("Existing output has an incompatible CSV header");
}

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TapCart field collection</title><style>body{font:16px system-ui;max-width:680px;margin:40px auto;padding:16px}label{display:block;margin:12px 0}input,select,button{font:inherit;padding:8px;display:block;width:100%;box-sizing:border-box}button{margin-top:12px}output{display:block;margin:16px 0;white-space:pre-wrap}</style><h1>Field collection</h1><p>Record instrumented trials. Latency is measured from physical scan initiation to the authoritative reservation response by your test instrumentation. This form does not measure hardware latency. Leave latency blank for failed attempts.</p><form id="trial"><label>Condition<input name="condition" required maxlength="200"></label><label>Phone model<input name="phone" required maxlength="200"></label><label>Tag model / QR label<input name="tag" required maxlength="200"></label><label>Material<input name="material" required maxlength="200"></label><label>Carrier<select name="carrier"><option>NFC</option><option>QR</option></select></label><label>Outcome<select name="success"><option value="true">Success</option><option value="false">Failed</option></select></label><label>Measured latency (ms)<input name="latency_ms" type="number" min="0" max="3600000" step="any"></label><button>Record trial</button></form><output id="status" role="status"></output><a href="/results.csv">Download collected CSV</a><script>document.getElementById('trial').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(form));data.success=data.success==='true';data.latency_ms=data.latency_ms===''?null:Number(data.latency_ms);try{const response=await fetch('/measurements',{method:'POST',headers:{'Content-Type':'application/json','X-Field-Token':'${token}'},body:JSON.stringify(data)});const result=await response.json();document.getElementById('status').textContent=response.ok?'Trial recorded. Record every failure as well as every success.':result.error;if(response.ok)form.elements.latency_ms.value='';}catch{document.getElementById('status').textContent='Network failure: check the CSV before retrying to avoid double recording.';}finally{button.disabled=false;}});</script></html>`;
let writeQueue = Promise.resolve();
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  const url = new URL(request.url ?? "/", origin);
  if (request.headers.host !== `127.0.0.1:${port}`) {
    response.writeHead(403).end("Invalid host");
    return;
  }
  try {
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
    } else if (request.method === "GET" && url.pathname === "/results.csv") {
      await writeQueue;
      response
        .writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="field-measurements.csv"',
        })
        .end(await readFile(output));
    } else if (request.method === "POST" && url.pathname === "/measurements") {
      const supplied = String(request.headers["x-field-token"] ?? "");
      if (
        request.headers.origin !== origin ||
        supplied.length !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      ) {
        response.writeHead(403).end();
        return;
      }
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        response.writeHead(415).end();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > 4096) {
          response.writeHead(413).end();
          request.resume();
          return;
        }
        chunks.push(buffer);
      }
      const measurement = validateMeasurement(
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      );
      const write = writeQueue.then(() =>
        appendFile(output, measurementCsvRow(measurement), { mode: 0o600 }),
      );
      writeQueue = write.catch(() => undefined);
      await write;
      response
        .writeHead(201, { "Content-Type": "application/json" })
        .end(JSON.stringify({ recorded: true }));
    } else response.writeHead(404).end();
  } catch (error) {
    response
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: error instanceof Error ? error.message : "Collection failed" }));
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Field control: ${origin}\nCSV: ${output}\nLocal observer tool only; hardware readings are supplied by the researcher.`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close(() => {
      void writeQueue.finally(() => process.exit());
    });
  });
