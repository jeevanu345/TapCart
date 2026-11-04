import type { Express } from "express";
import type { Database } from "../db.js";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import { json } from "../db.js";
import { ApiError } from "../errors.js";
import { requireStore, roles } from "../auth.js";
import { assertCapacity } from "./saas.js";
import { event } from "../protocol.js";
import { idempotent, publicUnit, unitSelect } from "../protocol.js";
import {
  uuidValue,
  productSchema,
  product,
  productSelect,
  id,
  storeScope,
  toResult,
} from "./shared.js";
export function registerCatalogRoutes(app: Express, db: Database) {
  app.get("/api/products", async (req, res) => {
    const storeId =
      req.auth?.user.role === "STORE"
        ? req.auth.user.storeId
        : req.query.storeId
          ? uuidValue.parse(req.query.storeId)
          : null;
    const search = z
      .string()
      .max(200)
      .parse(req.query.search || "");
    const includeArchived = req.auth?.user.role === "ADMIN" || req.auth?.user.role === "STORE";
    res.json(
      json(
        (
          await db.query(
            `${productSelect} JOIN store s ON s.id=p.store_id WHERE ($1::uuid IS NULL OR p.store_id=$1) AND ($2 OR (p.active AND s.status='APPROVED')) AND (p.name ILIKE $3 OR p.sku ILIKE $3 OR p.category ILIKE $3) GROUP BY p.id ORDER BY p.created_at DESC LIMIT 1000`,
            [storeId, includeArchived, `%${search}%`],
          )
        ).rows,
      ),
    );
  });
  app.post("/api/products", roles("STORE", "ADMIN"), async (req, res) => {
    const input = productSchema.parse(req.body),
      storeId = await requireStore(db, req.auth!.user, req.body.storeId),
      productId = uuid();
    await assertCapacity(db, storeId, { products: 1 });
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,description,category,price_cents,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        productId,
        storeId,
        input.sku,
        input.name,
        input.description,
        input.category,
        input.priceCents,
        input.imageUrl,
      ],
    );
    res.status(201).json(await product(db, productId));
  });
  app.patch("/api/products/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const productId = id(req),
      current = await product(db, productId);
    await requireStore(db, req.auth!.user, current.storeId);
    const input = productSchema.extend({ active: z.boolean() }).partial().parse(req.body),
      merged = { ...current, ...input };
    await db.query(
      "UPDATE product SET sku=$2,name=$3,description=$4,category=$5,price_cents=$6,image_url=$7,active=$8 WHERE id=$1",
      [
        productId,
        merged.sku,
        merged.name,
        merged.description,
        merged.category,
        merged.priceCents,
        merged.imageUrl,
        merged.active,
      ],
    );
    res.json(await product(db, productId));
  });
  app.delete("/api/products/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const productId = id(req),
      current = await product(db, productId);
    await requireStore(db, req.auth!.user, current.storeId);
    await db.query("UPDATE product SET active=false WHERE id=$1", [productId]);
    res.json({ ok: true });
  });
  app.get("/api/units", async (req, res) => {
    const storeId =
      req.auth?.user.role === "STORE"
        ? req.auth.user.storeId
        : req.query.storeId
          ? uuidValue.parse(req.query.storeId)
          : null;
    const productId = req.query.productId ? uuidValue.parse(req.query.productId) : null;
    res.json(
      (
        await db.query(
          `${unitSelect} JOIN store s ON s.id=u.store_id WHERE ($1::uuid IS NULL OR u.store_id=$1) AND ($2::uuid IS NULL OR p.id=$2) AND (s.status='APPROVED' OR s.owner_id=$3) ORDER BY u.created_at DESC,u.id LIMIT 1000`,
          [storeId, productId, req.auth?.user.id || null],
        )
      ).rows.map((row) => publicUnit(row, req.auth)),
    );
  });
  app.get("/api/units/:id", async (req, res) => {
    const row = (
      await db.query(
        `${unitSelect} JOIN store s ON s.id=u.store_id WHERE u.id=$1 AND (s.status='APPROVED' OR s.owner_id=$2)`,
        [id(req), req.auth?.user.id || null],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Unit not found. Check the NFC link or staff code.");
    res.json(publicUnit(row, req.auth));
  });
  app.post("/api/units", roles("STORE", "ADMIN"), async (req, res) => {
    const input = z
        .object({ productId: uuidValue, quantity: z.number().int().min(1).max(500) })
        .parse(req.body),
      current = await product(db, input.productId);
    await requireStore(db, req.auth!.user, current.storeId);
    await assertCapacity(db, current.storeId, { units: input.quantity });
    const result = await idempotent(
      db,
      `receive:${req.auth!.user.id}`,
      req.get("Idempotency-Key"),
      input,
      async (client) => {
        const rows = [];
        for (let index = 0; index < input.quantity; index++) {
          const unitId = uuid();
          rows.push(
            (
              await client.query(
                "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,$4) RETURNING *",
                [
                  unitId,
                  input.productId,
                  current.storeId,
                  `${current.sku}-${unitId.slice(-8).toUpperCase()}`,
                ],
              )
            ).rows[0],
          );
        }
        await event(client, "UnitsReceived", input.productId, { count: rows.length });
        return { status: 201, body: { units: json(rows), count: rows.length } };
      },
    );
    toResult(res, result);
  });
  app.post("/api/products/import", roles("STORE", "ADMIN"), async (req, res) => {
    const { csv } = z.object({ csv: z.string().min(1).max(750_000) }).parse(req.body),
      rows = parseCsv(csv);
    if (rows.length < 2 || rows.length > 201)
      throw new ApiError(400, "Provide a header and 1–200 product rows.");
    const headers = rows[0];
    if (!["sku", "name", "priceCents", "quantity"].every((header) => headers.includes(header)))
      throw new ApiError(400, "CSV headers must include sku,name,priceCents,quantity.");
    const entries = rows
      .slice(1)
      .filter((row) => row.some(Boolean))
      .map((row, index) => {
        const record = Object.fromEntries(
          headers.map((header, column) => [header, row[column] || ""]),
        );
        try {
          return {
            ...productSchema.parse({
              ...record,
              category: record.category || "General",
              priceCents: Number(record.priceCents),
            }),
            quantity: z.coerce.number().int().min(1).max(100).parse(record.quantity),
          };
        } catch {
          throw new ApiError(
            400,
            `Row ${index + 2} is invalid. Check name, SKU, priceCents and quantity.`,
          );
        }
      });
    if (entries.reduce((total, item) => total + item.quantity, 0) > 2000)
      throw new ApiError(400, "Import at most 2,000 physical units at once.");
    const storeId = await requireStore(db, req.auth!.user, req.body.storeId);
    await assertCapacity(db, storeId, {
      products: entries.length,
      units: entries.reduce((total, item) => total + item.quantity, 0),
    });
    const result = await db.transaction(async (client) => {
      let units = 0;
      for (const entry of entries) {
        const productId = uuid();
        await client.query(
          "INSERT INTO product(id,store_id,sku,name,description,category,price_cents,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            productId,
            storeId,
            entry.sku,
            entry.name,
            entry.description,
            entry.category,
            entry.priceCents,
            entry.imageUrl,
          ],
        );
        for (let index = 0; index < entry.quantity; index++) {
          const unitId = uuid();
          await client.query(
            "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,$4)",
            [unitId, productId, storeId, `${entry.sku}-${unitId.slice(-8).toUpperCase()}`],
          );
          units++;
        }
      }
      return { products: entries.length, units };
    });
    res.status(201).json(result);
  });
  app.get("/api/exports/:kind", roles("STORE", "ADMIN"), async (req, res) => {
    const kind = z.enum(["products", "units", "orders"]).parse(req.params.kind),
      scope = storeScope(req);
    const queries = {
      products: `SELECT p.sku,p.name,p.category,p.price_cents,p.active,count(u.id) FILTER(WHERE u.status='AVAILABLE')::int AS available,count(u.id) FILTER(WHERE u.status='RESERVED')::int AS reserved,count(u.id) FILTER(WHERE u.status='SOLD')::int AS sold FROM product p LEFT JOIN inventory_unit u ON u.product_id=p.id WHERE ($1::uuid IS NULL OR p.store_id=$1) GROUP BY p.id ORDER BY p.name`,
      units: `SELECT u.id,p.sku,p.name,u.staff_code,u.status,u.version,u.sale_epoch FROM inventory_unit u JOIN product p ON p.id=u.product_id WHERE ($1::uuid IS NULL OR u.store_id=$1) ORDER BY p.name,u.id`,
      orders: `SELECT o.id,u.name AS customer,o.status,o.payment_method,o.total_cents,o.created_at,o.paid_at,o.completed_at FROM customer_order o JOIN app_user u ON u.id=o.user_id WHERE ($1::uuid IS NULL OR o.store_id=$1) ORDER BY o.created_at DESC`,
    };
    const rows = (await db.query(queries[kind], [scope])).rows,
      columns = rows.length ? Object.keys(rows[0]) : ["No records"];
    const csv = [
      columns.map(csvCell).join(","),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\r\n");
    res.type("text/csv").attachment(`tapcart-${kind}.csv`).send(csv);
  });
}
function csvCell(value: unknown) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^\s*[=+@-]|^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      rows.push([...row]);
      row.length = 0;
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new ApiError(400, "CSV contains an unclosed quoted field.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
