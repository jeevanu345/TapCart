import type { Express, Request } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import type { Database } from "../db.js";
import { json } from "../db.js";
import { requireStore, roles } from "../auth.js";
import { ApiError } from "../errors.js";
import { event, idempotent } from "../protocol.js";
import { id, toResult, uuidValue } from "../routes/shared.js";
import { purchaseSchema, validatePurchase } from "../commerce/purchasing.js";
import { catalog, forecasts } from "./data.js";
import { searchCatalog } from "./catalog.js";
import { extractInvoice, readInvoiceFile } from "./invoices.js";
import { detectAnomalies } from "./anomalies.js";
import { answerStoreQuestion, languages } from "./assistant.js";
async function scope(db: Database, req: Request, manage = false) {
  if (
    manage &&
    req.auth!.user.role !== "ADMIN" &&
    !["OWNER", "MANAGER"].includes(req.auth!.user.storeRole ?? "")
  )
    throw new ApiError(403, "An owner or manager must approve this action.");
  return requireStore(
    db,
    req.auth!.user,
    req.query.storeId === undefined ? undefined : uuidValue.parse(req.query.storeId),
  );
}
export function registerIntelligenceRoutes(app: Express, db: Database) {
  app.get(
    "/api/catalog/search",
    rateLimit({ windowMs: 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }),
    async (req, res) => {
      const storeId = uuidValue.parse(req.query.storeId),
        q = z.string().trim().min(1).max(300).parse(req.query.q);
      if (
        !(await db.query("SELECT id FROM store WHERE id=$1 AND status='APPROVED'", [storeId]))
          .rowCount
      )
        throw new ApiError(404, "Catalog not found.");
      res.json(await searchCatalog(await catalog(db, storeId), q, storeId));
    },
  );
  const staff = roles("STORE", "ADMIN");
  app.use(
    "/api/intelligence",
    staff,
    rateLimit({
      windowMs: 60000,
      limit: 30,
      keyGenerator: (req) => req.auth!.user.id,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/intelligence/forecasts", staff, async (req, res) =>
    res.json(await forecasts(db, await scope(db, req))),
  );
  app.patch("/api/intelligence/planning/:id", staff, async (req, res) => {
    const storeId = await scope(db, req, true),
      productId = id(req),
      input = z
        .object({
          supplierId: uuidValue.nullable(),
          leadTimeDays: z.number().int().min(0).max(365).nullable(),
          reviewDays: z.number().int().min(1).max(90),
          minimumStock: z.number().int().min(0).max(1000000),
        })
        .strict()
        .parse(req.body);
    await db.transaction(async (client) => {
      if (
        input.supplierId &&
        !(
          await client.query("SELECT id FROM supplier WHERE id=$1 AND store_id=$2 AND active", [
            input.supplierId,
            storeId,
          ])
        ).rowCount
      )
        throw new ApiError(404, "Supplier not found.");
      if (
        !(
          await client.query(
            "UPDATE product SET supplier_id=$3,lead_time_days=$4,review_days=$5,minimum_stock=$6 WHERE id=$1 AND store_id=$2",
            [
              productId,
              storeId,
              input.supplierId,
              input.leadTimeDays,
              input.reviewDays,
              input.minimumStock,
            ],
          )
        ).rowCount
      )
        throw new ApiError(404, "Product not found.");
      await event(client, "ReplenishmentPolicyUpdated", productId, {
        storeId,
        actorId: req.auth!.user.id,
        ...input,
      });
    });
    res.json({ ok: true });
  });
  app.get("/api/intelligence/search", staff, async (req, res) => {
    const storeId = await scope(db, req),
      q = z.string().trim().min(1).max(300).parse(req.query.q);
    res.json(await searchCatalog(await catalog(db, storeId), q, storeId));
  });
  app.post("/api/intelligence/assistant", staff, async (req, res) => {
    const storeId = await scope(db, req),
      input = z
        .object({
          message: z.string().trim().min(1).max(1500),
          language: z.enum(languages).default("en"),
        })
        .strict()
        .parse(req.body);
    res.json(await answerStoreQuestion(db, storeId, input.message, input.language));
  });
  app.get("/api/intelligence/alerts", staff, async (req, res) =>
    res.json(
      json(
        (
          await db.query(
            "SELECT * FROM operational_alert WHERE store_id=$1 ORDER BY last_seen_at DESC LIMIT 100",
            [await scope(db, req)],
          )
        ).rows,
      ),
    ),
  );
  app.post("/api/intelligence/alerts/scan", staff, async (req, res) =>
    res.json(await detectAnomalies(db, await scope(db, req))),
  );
  app.patch("/api/intelligence/alerts/:id", staff, async (req, res) => {
    const storeId = await scope(db, req, true),
      alertId = id(req),
      input = z
        .object({
          status: z.enum(["ACKNOWLEDGED", "DISMISSED", "RESOLVED"]),
          note: z.string().trim().min(3).max(1000),
        })
        .strict()
        .parse(req.body);
    await db.transaction(async (client) => {
      if (
        !(
          await client.query(
            "UPDATE operational_alert SET status=$3,note=$4,reviewed_by=$5,reviewed_at=now() WHERE id=$1 AND store_id=$2",
            [alertId, storeId, input.status, input.note, req.auth!.user.id],
          )
        ).rowCount
      )
        throw new ApiError(404, "Alert not found.");
      await client.query(
        "INSERT INTO alert_review(id,alert_id,actor_id,status,note) VALUES($1,$2,$3,$4,$5)",
        [uuid(), alertId, req.auth!.user.id, input.status, input.note],
      );
      await event(client, "OperationalAlertReviewed", alertId, {
        storeId,
        actorId: req.auth!.user.id,
        ...input,
      });
    });
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2, fieldSize: 100000 },
  }).single("invoice");
  app.post(
    "/api/intelligence/invoices",
    staff,
    rateLimit({ windowMs: 60000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false }),
    async (req, res, next) => {
      await scope(db, req, true);
      next();
    },
    upload,
    async (req, res) => {
      const storeId = await scope(db, req, true);
      const raw = req.file
        ? await readInvoiceFile(req.file.buffer, req.file.mimetype)
        : { text: z.string().trim().min(1).max(100000).parse(req.body.text), engine: "TEXT" };
      const result = extractInvoice(raw.text, await catalog(db, storeId)),
        extractionId = uuid(),
        sourceHash = createHash("sha256")
          .update(req.file?.buffer ?? raw.text)
          .digest("hex");
      const row = await db.transaction(async (client) => {
        const resultRow = (
          await client.query(
            "INSERT INTO invoice_extraction(id,store_id,created_by,source_name,source_hash,engine,extracted_text,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *",
            [
              extractionId,
              storeId,
              req.auth!.user.id,
              (req.file?.originalname ?? "Pasted text").slice(0, 255),
              sourceHash,
              raw.engine,
              raw.text,
              JSON.stringify(result),
            ],
          )
        ).rows[0];
        await event(client, "InvoiceExtracted", extractionId, {
          storeId,
          actorId: req.auth!.user.id,
          sourceHash,
          engine: raw.engine,
        });
        return resultRow;
      });
      res.status(201).json(json(row));
    },
  );
  app.get("/api/intelligence/invoices", staff, async (req, res) =>
    res.json(
      json(
        (
          await db.query(
            "SELECT id,source_name,engine,result,draft_id,created_at FROM invoice_extraction WHERE store_id=$1 ORDER BY created_at DESC LIMIT 50",
            [await scope(db, req, true)],
          )
        ).rows,
      ),
    ),
  );
  app.post("/api/intelligence/invoices/:id/draft", staff, async (req, res) => {
    const storeId = await scope(db, req, true),
      extractionId = id(req),
      input = purchaseSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `invoice-draft:${storeId}`,
        req.get("Idempotency-Key"),
        { extractionId, ...input },
        async (client) => {
          const extraction = (
            await client.query(
              "SELECT * FROM invoice_extraction WHERE id=$1 AND store_id=$2 FOR UPDATE",
              [extractionId, storeId],
            )
          ).rows[0];
          if (!extraction) throw new ApiError(404, "Extraction not found.");
          if (extraction.draft_id)
            throw new ApiError(409, "This extraction already has a receiving draft.");
          await validatePurchase(client, storeId, input);
          const draftId = uuid();
          await client.query(
            "INSERT INTO purchase_draft(id,store_id,supplier_id,invoice_number,notes,lines,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
            [
              draftId,
              storeId,
              input.supplierId ?? null,
              input.invoiceNumber,
              input.notes,
              JSON.stringify(input.lines),
              req.auth!.user.id,
            ],
          );
          await client.query("UPDATE invoice_extraction SET draft_id=$2 WHERE id=$1", [
            extractionId,
            draftId,
          ]);
          await event(client, "InvoiceDraftReviewed", extractionId, {
            storeId,
            draftId,
            actorId: req.auth!.user.id,
          });
          return { status: 201, body: { draftId } };
        },
      ),
    );
  });
}
