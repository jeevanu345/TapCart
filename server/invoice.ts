import { z } from "zod";
import { formatMoney } from "./intelligence.js";

const receiptSchema = z.object({
  id: z.string().uuid(),
  storeName: z.string(),
  customerName: z.string(),
  status: z.string(),
  totalCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      sku: z.string(),
      priceCents: z.number().int().nonnegative(),
      returnedAt: z.string().nullable(),
    }),
  ),
});
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char,
  );
export function renderInvoice(value: unknown): string {
  const order = receiptSchema.parse(value);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TapCart receipt ${escape(order.id)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#183a2d;max-width:720px;margin:40px auto;padding:20px}header{border-bottom:2px solid #214d3e}table{width:100%;border-collapse:collapse;margin:25px 0}th,td{text-align:left;padding:12px 4px;border-bottom:1px solid #ddd}td:last-child,th:last-child{text-align:right}small{display:block;color:#5c675f}.total{font-size:20px;font-weight:700;text-align:right}footer{margin-top:35px;color:#5c675f}@media print{body{margin:0;max-width:none}a{display:none}}</style></head><body><header><strong>TapCart · ${escape(order.storeName)}</strong><h1>Payment receipt</h1></header><p>Order: ${escape(order.id)}<br>Customer: ${escape(order.customerName)}<br>Created: ${escape(new Date(order.createdAt).toISOString())}<br>Status: ${escape(order.status.replaceAll("_", " "))}</p><table><thead><tr><th>Item · one physical unit</th><th>Amount</th></tr></thead><tbody>${order.items.map((item) => `<tr><td>${escape(item.name)}<small>${escape(item.sku)}${item.returnedAt ? " · Returned" : ""}</small></td><td>${formatMoney(item.priceCents)}</td></tr>`).join("")}</tbody></table><p class="total">Original total: ${formatMoney(order.totalCents)}</p>${order.refundedCents ? `<p class="total">Refunded: ${formatMoney(order.refundedCents)}</p>` : ""}<footer>Thank you for shopping with ${escape(order.storeName)}.<br>This receipt reflects the server-confirmed order. It is not a GST tax invoice.<br>Use your browser’s Print command to print or save this receipt.</footer></body></html>`;
}
