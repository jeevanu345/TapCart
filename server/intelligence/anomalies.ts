import { v7 as uuid } from "uuid";
import type { Database } from "../db.js";
import { event } from "../protocol.js";
import { json } from "../db.js";
export interface AlertSignal {
  fingerprint: string;
  kind: string;
  severity: "HIGH" | "MEDIUM";
  title: string;
  evidence: Record<string, unknown>;
}
export function reservationSignal(recent: number, previous: number): AlertSignal | null {
  const baseline = previous / 28;
  if (recent < 20 || recent < Math.max(20, baseline * 4)) return null;
  return {
    fingerprint: "reservation-burst",
    kind: "RESERVATION_BURST",
    severity: "MEDIUM",
    title: "Reservation activity is unusually high",
    evidence: {
      recent15Minutes: recent,
      priorSevenHours: previous,
      expected15Minutes: Math.round(baseline * 100) / 100,
      rule: "At least 20 reservations and four times the prior seven-hour average. Review traffic before taking action.",
    },
  };
}
export async function detectAnomalies(db: Database, storeId: string) {
  const signals: AlertSignal[] = [];
  const activity = (
    await db.query(
      `SELECT count(*) FILTER(WHERE e.created_at>=now()-interval '15 minutes')::int recent,count(*) FILTER(WHERE e.created_at<now()-interval '15 minutes')::int previous FROM outbox e JOIN inventory_unit u ON u.id=e.aggregate_id WHERE e.event_type='InventoryReserved' AND u.store_id=$1 AND e.created_at>=now()-interval '7 hours 15 minutes'`,
      [storeId],
    )
  ).rows[0];
  const burst = reservationSignal(activity.recent, activity.previous);
  if (burst) signals.push(burst);
  const refund = (
    await db.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE refund_due_cents>0 OR refunded_cents>0)::int refunds,coalesce(sum(refund_due_cents),0)::bigint outstanding FROM customer_order WHERE store_id=$1 AND created_at>=now()-interval '7 days' AND status IN('COMPLETED','REFUND_PENDING','REFUNDED')`,
      [storeId],
    )
  ).rows[0];
  if (refund.total >= 10 && refund.refunds >= 3 && refund.refunds / refund.total >= 0.2)
    signals.push({
      fingerprint: "refund-rate",
      kind: "REFUND_RATE",
      severity: "MEDIUM",
      title: "Elevated seven-day refund rate",
      evidence: {
        orders: refund.total,
        ordersWithRefund: refund.refunds,
        outstandingCents: Number(refund.outstanding),
        threshold: "At least 10 paid orders, three refunds and 20% refund incidence.",
      },
    });
  const discrepancies = (
    await db.query(
      `SELECT u.id,u.staff_code,u.status,u.sale_epoch FROM inventory_unit u WHERE u.store_id=$1 AND ((u.status='SOLD' AND NOT EXISTS(SELECT 1 FROM unit_sale s WHERE s.unit_id=u.id AND s.sale_epoch=u.sale_epoch AND s.order_id=u.sold_order_id AND s.returned_at IS NULL)) OR (u.status<>'SOLD' AND EXISTS(SELECT 1 FROM unit_sale s WHERE s.unit_id=u.id AND s.sale_epoch=u.sale_epoch AND s.returned_at IS NULL))) ORDER BY u.id LIMIT 51`,
      [storeId],
    )
  ).rows;
  if (discrepancies.length)
    signals.push({
      fingerprint: "ledger-discrepancy",
      kind: "STOCK_DISCREPANCY",
      severity: "HIGH",
      title: "Inventory and sale ledger require review",
      evidence: {
        units: discrepancies.slice(0, 50),
        more: discrepancies.length > 50,
        rule: "Current sale epoch must agree with physical unit state. No records are automatically repaired.",
      },
    });
  const pending = (
    await db.query(
      `SELECT id,status,created_at FROM customer_order WHERE store_id=$1 AND (status='PAID' AND paid_at<now()-interval '5 minutes' OR status='REFUND_PENDING' AND created_at<now()-interval '1 hour') ORDER BY created_at LIMIT 50`,
      [storeId],
    )
  ).rows;
  if (pending.length)
    signals.push({
      fingerprint: "unsettled-paid-orders",
      kind: "PAYMENT_REVIEW",
      severity: "HIGH",
      title: "Paid or refund-pending orders need attention",
      evidence: {
        orders: pending,
        rule: "Paid for more than five minutes or refund-pending orders created more than one hour ago.",
      },
    });
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `anomalies:${storeId}`,
    ]);
    for (const signal of signals) {
      const previous = (
        await client.query(
          "SELECT status FROM operational_alert WHERE store_id=$1 AND fingerprint=$2 FOR UPDATE",
          [storeId, signal.fingerprint],
        )
      ).rows[0];
      const inserted = await client.query(
        `INSERT INTO operational_alert(id,store_id,fingerprint,kind,severity,title,evidence) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(store_id,fingerprint) DO UPDATE SET evidence=excluded.evidence,last_seen_at=now(),status=CASE WHEN operational_alert.status='RESOLVED' THEN 'OPEN' ELSE operational_alert.status END RETURNING id`,
        [
          uuid(),
          storeId,
          signal.fingerprint,
          signal.kind,
          signal.severity,
          signal.title,
          JSON.stringify(signal.evidence),
        ],
      );
      if (!previous || previous.status === "RESOLVED")
        await event(client, "OperationalAnomalyDetected", inserted.rows[0].id, {
          storeId,
          alertId: inserted.rows[0].id,
          title: signal.title,
          kind: signal.kind,
          severity: signal.severity,
        });
    }
  });
  return json(
    (
      await db.query(
        "SELECT * FROM operational_alert WHERE store_id=$1 ORDER BY status,last_seen_at DESC LIMIT 100",
        [storeId],
      )
    ).rows,
  );
}
