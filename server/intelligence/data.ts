import type { Database } from "../db.js";
import { forecast, type DailySale } from "./forecast.js";
import type { CatalogItem } from "./catalog.js";
export async function catalog(db: Database, storeId: string): Promise<CatalogItem[]> {
  return (
    await db.query(
      `SELECT p.id,p.name,p.sku,p.description,p.category,p.price_cents AS "priceCents",count(u.id) FILTER(WHERE u.status='AVAILABLE')::int available FROM product p LEFT JOIN inventory_unit u ON u.product_id=p.id WHERE p.store_id=$1 AND p.active GROUP BY p.id ORDER BY p.name LIMIT 2000`,
      [storeId],
    )
  ).rows as CatalogItem[];
}
export async function forecasts(db: Database, storeId: string) {
  const rows = (
    await db.query(
      `SELECT p.id,p.name,p.supplier_id,p.lead_time_days,p.review_days,p.minimum_stock,s.name supplier_name,coalesce(p.lead_time_days,s.lead_time_days,7) lead_days,
 (SELECT count(*)::int FROM inventory_unit u WHERE u.product_id=p.id AND u.status='AVAILABLE') available,
 (SELECT coalesce(sum(l.quantity-l.received_quantity),0)::int FROM purchase_order_line l JOIN purchase_order o ON o.id=l.order_id WHERE l.product_id=p.id AND o.store_id=p.store_id AND o.status IN ('OPEN','PARTIAL')) on_order,
 (SELECT jsonb_agg(jsonb_build_object('date',to_char(d,'YYYY-MM-DD'),'quantity',coalesce(sales.quantity,0)) ORDER BY d) FROM generate_series(greatest((p.created_at AT TIME ZONE 'Asia/Kolkata')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date-179),(now() AT TIME ZONE 'Asia/Kolkata')::date-1,'1 day') d LEFT JOIN (SELECT (us.sold_at AT TIME ZONE 'Asia/Kolkata')::date sale_day,count(*)::int quantity FROM unit_sale us JOIN inventory_unit iu ON iu.id=us.unit_id WHERE iu.product_id=p.id AND us.returned_at IS NULL GROUP BY sale_day) sales ON sales.sale_day=d::date) history
 FROM product p LEFT JOIN supplier s ON s.id=p.supplier_id WHERE p.store_id=$1 AND p.active ORDER BY p.name LIMIT 2000`,
      [storeId],
    )
  ).rows;
  return rows.map((row) => ({
    ...forecast({
      productId: row.id,
      name: row.name,
      available: row.available,
      onOrder: row.on_order,
      leadTimeDays: row.lead_days,
      reviewDays: row.review_days,
      minimumStock: row.minimum_stock,
      history: (row.history ?? []) as DailySale[],
    }),
    supplierId: row.supplier_id as string | null,
    supplierName: row.supplier_name as string | null,
    leadTimeOverride: row.lead_time_days as number | null,
  }));
}
