import type { Express } from "express";
import type { Database } from "../db.js";
import type { Request } from "express";
import { z } from "zod";
import { json } from "../db.js";
import { roles } from "../auth.js";
import { getOrder } from "../protocol.js";
import { productSelect, storeScope } from "./shared.js";
export function registerReportingRoutes(app: Express, db: Database) {
  async function analytics(req: Request) {
    const scope = storeScope(req);
    const [daily, top, statuses, categories] = await Promise.all([
      db.query(
        `WITH days AS (SELECT generate_series(date_trunc('day',now())-interval '29 days',date_trunc('day',now()),interval '1 day') AS day), sales AS (SELECT date_trunc('day',s.sold_at) AS day,coalesce(sum(s.price_cents) FILTER(WHERE s.returned_at IS NULL),0)::float8 revenue_cents,count(DISTINCT s.order_id)::int orders FROM unit_sale s JOIN inventory_unit u ON u.id=s.unit_id WHERE s.sold_at>=date_trunc('day',now())-interval '29 days' AND ($1::uuid IS NULL OR u.store_id=$1) GROUP BY 1) SELECT to_char(d.day,'YYYY-MM-DD') date,coalesce(s.revenue_cents,0) revenue_cents,coalesce(s.orders,0) orders FROM days d LEFT JOIN sales s ON s.day=d.day ORDER BY d.day`,
        [scope],
      ),
      db.query(
        `SELECT p.id,p.name,count(*)::int AS units,sum(s.price_cents)::float8 AS revenue_cents FROM unit_sale s JOIN inventory_unit u ON u.id=s.unit_id JOIN product p ON p.id=u.product_id WHERE s.returned_at IS NULL AND ($1::uuid IS NULL OR u.store_id=$1) GROUP BY p.id ORDER BY revenue_cents DESC LIMIT 10`,
        [scope],
      ),
      db.query(
        "SELECT status,count(*)::int AS count FROM inventory_unit WHERE ($1::uuid IS NULL OR store_id=$1) GROUP BY status",
        [scope],
      ),
      db.query(
        `SELECT p.category,count(*)::int AS units,sum(s.price_cents)::float8 AS revenue_cents FROM unit_sale s JOIN inventory_unit u ON u.id=s.unit_id JOIN product p ON p.id=u.product_id WHERE s.returned_at IS NULL AND ($1::uuid IS NULL OR u.store_id=$1) GROUP BY p.category ORDER BY revenue_cents DESC`,
        [scope],
      ),
    ]);
    return json({
      daily_sales: daily.rows,
      top_products: top.rows,
      status_counts: statuses.rows,
      category_sales: categories.rows,
    });
  }
  app.get("/api/analytics", roles("ADMIN", "STORE"), async (req, res) =>
    res.json(await analytics(req)),
  );
  app.get("/api/customers", roles("ADMIN", "STORE"), async (req, res) =>
    res.json(
      json(
        (
          await db.query(
            `SELECT u.id,u.name,u.email,count(o.id)::int AS orders,COALESCE(sum(o.total_cents-o.refunded_cents),0)::float8 AS total_cents,max(o.created_at) AS last_order_at FROM app_user u JOIN customer_order o ON o.user_id=u.id WHERE o.completed_at IS NOT NULL AND ($1::uuid IS NULL OR o.store_id=$1) GROUP BY u.id ORDER BY last_order_at DESC LIMIT 500`,
            [storeScope(req)],
          )
        ).rows,
      ),
    ),
  );
  app.get("/api/dashboard", roles("ADMIN", "STORE"), async (req, res) => {
    const scope = storeScope(req);
    const [metrics, orderIds, lowStock, charts] = await Promise.all([
      db.query(
        `SELECT (SELECT COALESCE(sum(s.price_cents) FILTER(WHERE s.returned_at IS NULL),0)::float8 FROM unit_sale s JOIN inventory_unit u ON u.id=s.unit_id WHERE ($1::uuid IS NULL OR u.store_id=$1)) AS revenue_cents,
    (SELECT count(*)::int FROM customer_order WHERE completed_at IS NOT NULL AND ($1::uuid IS NULL OR store_id=$1)) AS completed_orders,
    (SELECT count(*)::int FROM inventory_unit WHERE status='AVAILABLE' AND ($1::uuid IS NULL OR store_id=$1)) AS available_units,
    (SELECT count(*)::int FROM inventory_unit WHERE status='RESERVED' AND ($1::uuid IS NULL OR store_id=$1)) AS reserved_units,
    (SELECT count(*)::int FROM inventory_unit WHERE status='SOLD' AND ($1::uuid IS NULL OR store_id=$1)) AS sold_units,
    (SELECT count(*)::int FROM product WHERE active AND ($1::uuid IS NULL OR store_id=$1)) AS products,
    (SELECT count(DISTINCT user_id)::int FROM customer_order WHERE ($1::uuid IS NULL OR store_id=$1)) AS customers,
    (SELECT count(*)::int FROM store WHERE status='PENDING' AND $1::uuid IS NULL) AS pending_stores`,
        [scope],
      ),
      db.query(
        "SELECT id FROM customer_order WHERE ($1::uuid IS NULL OR store_id=$1) ORDER BY created_at DESC LIMIT 8",
        [scope],
      ),
      db.query(
        `${productSelect} WHERE p.active AND ($1::uuid IS NULL OR p.store_id=$1) GROUP BY p.id HAVING count(u.id) FILTER(WHERE u.status='AVAILABLE')<6 ORDER BY available,p.name LIMIT 10`,
        [scope],
      ),
      analytics(req),
    ]);
    res.json({
      metrics: json(metrics.rows[0]),
      recentOrders: await Promise.all(orderIds.rows.map((row) => getOrder(db, row.id))),
      lowStock: json(lowStock.rows),
      dailySales: charts.dailySales,
    });
  });
  app.get("/api/events", roles("ADMIN"), async (req, res) => {
    const after = req.query.after
      ? z.string().datetime().parse(req.query.after)
      : "1970-01-01T00:00:00.000Z";
    res.json(
      json(
        (
          await db.query(
            "SELECT event_id AS id,event_type,aggregate_id,payload,delivered_at FROM event_delivery WHERE delivered_at>$1 ORDER BY delivered_at,event_id LIMIT 500",
            [after],
          )
        ).rows,
      ),
    );
  });
}
