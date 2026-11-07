import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync } from "node:fs";
import request from "supertest";
import { createCanvas } from "@napi-rs/canvas";
import { forecast } from "../intelligence/forecast.js";
import { parseSearch, searchCatalog, type CatalogItem } from "../intelligence/catalog.js";
import { extractInvoice, readInvoiceFile, imageDimensions } from "../intelligence/invoices.js";
import { reservationSignal, detectAnomalies } from "../intelligence/anomalies.js";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { hashPassword } from "../auth.js";
function pdfDocument(objects: (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof object === "string" ? Buffer.from(object) : object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    size += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
          .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`,
    ),
  );
  return Buffer.concat(parts);
}
const product: CatalogItem = {
  id: randomUUID(),
  sku: "COFFEE-01",
  name: "Coffee beans",
  category: "Beverages",
  description: "Roasted arabica for espresso and cappuccino",
  priceCents: 24000,
  available: 8,
};
const milk: CatalogItem = {
  ...product,
  id: randomUUID(),
  sku: "MILK-01",
  name: "Dairy milk",
  description: "Fresh whole milk",
  priceCents: 6000,
};
const expensive: CatalogItem = {
  ...product,
  id: randomUUID(),
  sku: "COFFEE-02",
  name: "Premium coffee",
  priceCents: 90000,
};
function series(n: number, quantity: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    quantity: quantity(i),
  }));
}
function plan(history = series(60, () => 3)) {
  return {
    productId: product.id,
    name: product.name,
    available: 5,
    onOrder: 8,
    leadTimeDays: 4,
    reviewDays: 3,
    minimumStock: 0,
    history,
  };
}
describe("Forecasting, search and document extraction", () => {
  it("uses supplier horizon and incoming stock without future-day leakage", () => {
    const result = forecast(plan());
    expect(result.planningDemand).toBe(21);
    expect(result.reorderQuantity).toBe(8);
    expect(result.backtest.mae).toBe(0);
    expect(result.backtest.origins).toBeGreaterThan(10);
    const short = forecast({ ...plan(), history: series(13, () => 4) });
    expect(short.backtest.origins).toBe(0);
    expect(short.backtest.mae).toBeNull();
  });
  it("selects weekday seasonality from rolling held-out observations", () => {
    const history = series(120, (i) =>
      new Date(Date.UTC(2026, 0, 1) + i * 86400000).getUTCDay() === 0 ? 30 : 1,
    );
    const f = forecast({ ...plan(history), leadTimeDays: 1, reviewDays: 1 });
    expect(f.method).toBe("weekday");
    expect(f.backtest.mae).toBeLessThan(
      f.backtest.candidates.find((c) => c.method === "mean")!.mae!,
    );
  });
  it("reports sparse/zero demand honestly and enforces minimum targets", () => {
    const f = forecast({ ...plan([]), minimumStock: 20 });
    expect(f.dataQuality).toBe("SPARSE_HISTORY");
    expect(f.reorderQuantity).toBe(7);
    expect(f.daysOfStock).toBeNull();
    expect(f.backtest.wape).toBeNull();
  });
  it("parses INR filters and Hindi synonyms and never returns an over-budget item", async () => {
    expect(parseSearch("कॉफी under ₹500").text).toBe("coffee");
    expect(parseSearch("coffee under ₹1,000").maxPriceCents).toBe(100000);
    const result = await searchCatalog(
      [product, milk, expensive],
      "espresso under ₹500",
      randomUUID(),
      async (texts) => texts.map((t) => (t.toLowerCase().includes("milk") ? [0, 1] : [1, 0])),
    );
    expect(result.mode).toBe("semantic-local");
    expect(result.results.map((p) => p.id)).toEqual([product.id]);
    const fallback = await searchCatalog(
      [product, milk, expensive],
      "coffee under ₹500",
      randomUUID(),
      async () => {
        throw Error("offline");
      },
    );
    expect(fallback.mode).toBe("lexical-local");
    expect(fallback.results.map((p) => p.id)).toEqual([product.id]);
  });
  it("extracts explicit quantities/costs with source evidence and no invented SKU matches", () => {
    const extracted = extractInvoice(
      "Invoice # SUP-104\nCOFFEE-01, 12, 180.25\nUnknown item, 4, 90\nTotal 2523.00",
      [product],
    );
    expect(extracted.invoiceNumber).toBe("SUP-104");
    expect(extracted.lines).toHaveLength(2);
    expect(extracted.lines[0]).toMatchObject({
      productId: product.id,
      quantity: 12,
      unitCostCents: 18025,
      confidence: "EXACT_SKU",
    });
    expect(extracted.lines[1].productId).toBeNull();
    const grouped = extractInvoice("COFFEE-01, 5, ₹1,000.00", [product]);
    expect(grouped.lines[0]).toMatchObject({ quantity: 5, unitCostCents: 100000 });
  });
  it("rejects image decompression bombs from headers before native decoding", async () => {
    const data = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
    data.write("IHDR", 12);
    data.writeUInt32BE(100000, 16);
    data.writeUInt32BE(100000, 20);
    expect(imageDimensions(data)).toEqual({ width: 100000, height: 100000 });
    await expect(readInvoiceFile(data, "image/png")).rejects.toThrow(/16 megapixels/);
    await expect(readInvoiceFile(Buffer.from("bad"), "image/png")).rejects.toThrow(/Supported/);
  });
  it("decodes a real PDF invoice with PDF.js text extraction", async () => {
    const stream =
      "BT /F1 16 Tf 40 700 Td (Invoice # PDF-105) Tj 0 -30 Td (COFFEE-01 12 180.25) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let document = "%PDF-1.4\n";
    const offsets = [0];
    for (const [i, obj] of objects.entries()) {
      offsets.push(Buffer.byteLength(document));
      document += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    }
    const xref = Buffer.byteLength(document);
    document +=
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
        .join("") +
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const result = await readInvoiceFile(Buffer.from(document), "application/pdf");
    expect(result.engine).toBe("PDF_TEXT");
    expect(extractInvoice(result.text, [product]).lines[0]).toMatchObject({
      quantity: 12,
      unitCostCents: 18025,
    });
  }, 30000);
  it("requires meaningful sample size for reservation anomaly signals", () => {
    expect(reservationSignal(19, 0)).toBeNull();
    expect(reservationSignal(30, 280)).toBeNull();
    expect(reservationSignal(45, 280)?.kind).toBe("RESERVATION_BURST");
  });
});
const models = existsSync(".cache/models") && existsSync(".cache/ocr/eng.traineddata");
if (process.env.AI_REQUIRE_MODELS === "true" && !models)
  throw Error("Run npm run ai:models before AI_REQUIRE_MODELS=true tests.");
describe.skipIf(!models)("Real local inference (provision with npm run ai:models)", () => {
  it("uses real embeddings to retrieve espresso by meaning while filtering price", async () => {
    const result = await searchCatalog(
      [product, milk, expensive],
      "a drink made with roasted beans under ₹500",
      randomUUID(),
    );
    expect(result.mode).toBe("semantic-local");
    expect(result.results[0].id).toBe(product.id);
    expect(result.results.every((p) => p.priceCents <= 50000)).toBe(true);
  }, 60000);
  it("recognizes a generated supplier image with actual Tesseract, not a mocked OCR engine", async () => {
    const canvas = createCanvas(1500, 360),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1500, 360);
    ctx.fillStyle = "black";
    ctx.font = "40px sans-serif";
    ctx.fillText("Invoice # OCR-104", 40, 70);
    ctx.fillText("COFFEE-01   12   180.25", 40, 160);
    const result = await readInvoiceFile(canvas.toBuffer("image/png"), "image/png");
    expect(result.engine).toBe("OCR");
    expect(result.text).toMatch(/180[.,]25/);
    const lines = extractInvoice(result.text, [product]).lines;
    expect(lines[0]?.quantity).toBe(12);
  }, 60000);
  it("renders and recognizes a scanned PDF with the real local OCR engine", async () => {
    const width = 1500,
      height = 360,
      canvas = createCanvas(width, height),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "black";
    ctx.font = "44px sans-serif";
    ctx.fillText("COFFEE-01   12   180.25", 40, 150);
    const pixels = ctx.getImageData(0, 0, width, height).data,
      rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < pixels.length; i += 4) {
      rgb[j++] = pixels[i];
      rgb[j++] = pixels[i + 1];
      rgb[j++] = pixels[i + 2];
    }
    const image = deflateSync(rgb),
      commands = "q 750 0 0 180 0 0 cm /Im0 Do Q";
    const document = pdfDocument([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 750 180] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
        ),
        image,
        Buffer.from("\nendstream"),
      ]),
      `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
    ]);
    const result = await readInvoiceFile(document, "application/pdf");
    expect(result.engine).toBe("PDF_OCR");
    expect(extractInvoice(result.text, [product]).lines[0]).toMatchObject({
      quantity: 12,
      unitCostCents: 18025,
    });
  }, 60000);
});
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.includes("test"))
  throw Error("Isolated TEST_DATABASE_URL required.");
describe("Authorized intelligence workflow in real PostgreSQL", () => {
  const schema = "intelligence_test_" + randomBytes(8).toString("hex"),
    scoped = new URL(url!);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const bootstrap = createDatabase(url!),
    db = createDatabase(scoped.toString()),
    origin = "http://localhost:5173",
    app = createApp(db, { origin, production: false, developmentPayments: true }),
    storeId = randomUUID(),
    ownerId = randomUUID(),
    otherStore = randomUUID();
  let owner: ReturnType<typeof request.agent>, csrf: string;
  beforeAll(async () => {
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
    await db.query(
      "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'AI owner','ai-owner@example.test',$2,'STORE')",
      [ownerId, await hashPassword("IntelligenceTest123!")],
    );
    await db.query(
      "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'AI Store','APPROVED')",
      [storeId, ownerId],
    );
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,price_cents,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '60 days')",
      [product.id, storeId, product.sku, product.name, product.priceCents],
    );
    owner = request.agent(app);
    const session = await owner.get("/api/auth/session");
    const login = await owner
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email: "ai-owner@example.test", password: "IntelligenceTest123!" });
    expect(login.status).toBe(200);
    csrf = login.body.csrfToken;
  });
  afterAll(async () => {
    await db.pool.end();
    await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.pool.end();
  });
  const post = (path: string, body: unknown, key = randomUUID()) =>
    owner
      .post("/api" + path)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .set("Idempotency-Key", key)
      .send(body);
  it("isolates store records and requires authentication", async () => {
    expect((await request(app).get("/api/intelligence/forecasts")).status).toBe(401);
    expect((await owner.get(`/api/intelligence/forecasts?storeId=${otherStore}`)).status).toBe(404);
    const result = await owner.get("/api/intelligence/forecasts");
    expect(result.status).toBe(200);
    expect(result.body[0].productId).toBe(product.id);
  });
  it("exposes only approved public catalog fields for shopper semantic search", async () => {
    const result = await request(app).get(
      `/api/catalog/search?storeId=${storeId}&q=coffee%20under%20%E2%82%B9500`,
    );
    expect(result.status).toBe(200);
    expect(result.body.results[0].id).toBe(product.id);
    expect(result.body.results[0]).not.toHaveProperty("supplierId");
    expect(result.body.results[0]).not.toHaveProperty("unitCostCents");
    expect(
      (await request(app).get(`/api/catalog/search?storeId=${otherStore}&q=coffee`)).status,
    ).toBe(404);
  });
  it("extracts an invoice then creates a reviewed draft exactly once without receiving stock", async () => {
    const extracted = await post("/intelligence/invoices", {
      text: "Invoice # API-1\nCOFFEE-01, 5, 100.00",
    });
    expect(extracted.status).toBe(201);
    expect(extracted.body.result.lines).toHaveLength(1);
    const key = randomUUID(),
      body = {
        invoiceNumber: "API-1",
        lines: [{ productId: product.id, quantity: 5, unitCostCents: 10000 }],
      },
      path = `/intelligence/invoices/${extracted.body.id}/draft`;
    const [a, b] = await Promise.all([post(path, body, key), post(path, body, key)]);
    expect(a.status).toBe(201);
    expect(b.body.draftId).toBe(a.body.draftId);
    expect((await db.query("SELECT count(*)::int n FROM inventory_unit")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int n FROM purchase_draft")).rows[0].n).toBe(1);
    expect((await post(path, body)).status).toBe(409);
  });
  it("grounds multilingual answers and handles the default replenishment question", async () => {
    const answer = await post("/intelligence/assistant", {
      message: "What needs replenishment?",
      language: "hi",
    });
    expect(answer.status).toBe(200);
    expect(answer.body.answer).toContain("पुनर्भरण");
    expect(answer.body.evidence[0].facts.productId).toBe(product.id);
    expect(answer.body.mode).toBe("grounded-local");
  });
  it("deduplicates concurrent anomaly scans and audits human review", async () => {
    const unitId = randomUUID();
    await db.query(
      "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,'AI-UNIT')",
      [unitId, product.id, storeId],
    );
    await db.query(
      "INSERT INTO outbox(id,event_type,aggregate_id,payload) SELECT gen_random_uuid(),'InventoryReserved',$1,'{}'::jsonb FROM generate_series(1,25)",
      [unitId],
    );
    await Promise.all([detectAnomalies(db, storeId), detectAnomalies(db, storeId)]);
    const alerts = await owner.get("/api/intelligence/alerts");
    expect(alerts.body).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM outbox WHERE event_type='OperationalAnomalyDetected'",
        )
      ).rows[0].n,
    ).toBe(1);
    const review = await owner
      .patch(`/api/intelligence/alerts/${alerts.body[0].id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ status: "ACKNOWLEDGED", note: "Investigating traffic" });
    expect(review.status).toBe(200);
    expect((await db.query("SELECT count(*)::int n FROM alert_review")).rows[0].n).toBe(1);
  });
});
