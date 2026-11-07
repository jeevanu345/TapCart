import { v7 as uuid } from "uuid";
import nodemailer from "nodemailer";
import type { Database } from "../db.js";
import type { AppOptions } from "../types.js";
import { decryptSecret, securityKey } from "../security/crypto.js";
import { enqueueEmail } from "./service.js";
import { logger } from "../logger.js";
export interface MailProvider {
  send(input: { to: string; subject: string; text: string; messageId: string }): Promise<void>;
}
export function notificationProvider(production: boolean): MailProvider | null {
  securityKey(production);
  const mode = process.env.EMAIL_MODE || (production ? "disabled" : "capture");
  if (mode === "capture") {
    if (production) throw new Error("EMAIL_MODE=capture is forbidden in production.");
    return null;
  }
  if (mode === "disabled")
    return {
      send: async () => {
        throw new Error("Email delivery is disabled.");
      },
    };
  if (mode !== "smtp") throw new Error("EMAIL_MODE must be smtp, capture or disabled.");
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
    throw new Error("SMTP_HOST and SMTP_FROM are required for SMTP delivery.");
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP_PORT.");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: production,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return {
    async send(input) {
      const result = await transport.sendMail({ from: process.env.SMTP_FROM, ...input });
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error("SMTP did not accept the recipient.");
    },
  };
}
export async function materializeNotificationEvents(db: Database, origin: string) {
  return db.transaction(async (client) => {
    const events = (
      await client.query(
        `SELECT e.* FROM event_delivery e WHERE NOT EXISTS(SELECT 1 FROM notification_event n WHERE n.event_id=e.event_id) ORDER BY delivered_at,event_id FOR UPDATE OF e SKIP LOCKED LIMIT 100`,
      )
    ).rows;
    for (const e of events) {
      if (e.event_type === "OperationalAnomalyDetected") {
        const storeId = e.payload.storeId;
        if (typeof storeId === "string" && /^[a-f0-9-]{36}$/i.test(storeId)) {
          const owner = (
            await client.query(
              "SELECT s.owner_id,s.name,u.email,u.email_verified_at FROM store s JOIN app_user u ON u.id=s.owner_id WHERE s.id=$1",
              [storeId],
            )
          ).rows[0];
          if (owner?.email_verified_at)
            await enqueueEmail(client, {
              dedupeKey: `event:${e.event_id}:anomaly-owner`,
              storeId,
              userId: owner.owner_id,
              recipient: owner.email,
              kind: "OPERATIONAL_ANOMALY",
              subject: `TapCart operational alert: ${String(e.payload.title || "Store review required").slice(0, 200)}`,
              body: `An operational signal needs review at ${owner.name}.\n${String(e.payload.title || "Store review required").slice(0, 500)}\nSeverity: ${String(e.payload.severity || "REVIEW")}\nOpen the evidence and review the alert before taking action.\n${origin}/store/intelligence/lab?tab=alerts&storeId=${storeId}`,
            });
        }
      }
      if (["InventorySold", "RefundConfirmed"].includes(e.event_type)) {
        const order = (
          await client.query(
            `SELECT o.*,u.email,u.email_verified_at,s.name AS store_name FROM customer_order o JOIN app_user u ON u.id=o.user_id JOIN store s ON s.id=o.store_id WHERE o.id=$1`,
            [e.aggregate_id],
          )
        ).rows[0];
        if (order?.email_verified_at)
          await enqueueEmail(client, {
            dedupeKey: `event:${e.event_id}:customer`,
            userId: order.user_id,
            storeId: order.store_id,
            recipient: order.email,
            kind: e.event_type === "InventorySold" ? "RECEIPT" : "REFUND",
            subject:
              e.event_type === "InventorySold"
                ? "Your TapCart receipt"
                : "Your TapCart refund confirmation",
            body: `${e.event_type === "InventorySold" ? "Payment and inventory sale confirmed" : "Refund confirmed"} for order ${order.id} at ${order.store_name}.\n${e.event_type === "InventorySold" ? `Total INR ${(order.total_cents / 100).toFixed(2)}.` : `Refund INR ${(Number(e.payload.amountCents || e.payload.amount_cents || 0) / 100).toFixed(2)}.`}\nView order: ${origin}/receipt/${order.id}`,
          });
        if (order && e.event_type === "InventorySold") {
          const low = (
            await client.query(
              `SELECT p.id,p.name,s.owner_id,s.low_stock_threshold,u.email,u.email_verified_at,count(i.id) FILTER(WHERE i.status='AVAILABLE')::int AS available FROM product p JOIN store s ON s.id=p.store_id JOIN app_user u ON u.id=s.owner_id LEFT JOIN inventory_unit i ON i.product_id=p.id WHERE p.id IN (SELECT product_id FROM order_unit WHERE order_id=$1) GROUP BY p.id,s.id,u.id HAVING count(i.id) FILTER(WHERE i.status='AVAILABLE')<=s.low_stock_threshold`,
              [order.id],
            )
          ).rows;
          for (const p of low)
            if (p.email_verified_at)
              await enqueueEmail(client, {
                dedupeKey: `event:${e.event_id}:low:${p.id}`,
                storeId: order.store_id,
                userId: p.owner_id,
                recipient: p.email,
                kind: "LOW_STOCK",
                subject: `Low stock: ${p.name}`,
                body: `${p.name} has ${p.available} available units (alert threshold ${p.low_stock_threshold}).\n${origin}/store/inventory`,
              });
        }
      }
      await client.query(
        "INSERT INTO notification_event(event_id) VALUES($1) ON CONFLICT DO NOTHING",
        [e.event_id],
      );
    }
    return events.length;
  });
}
export async function deliverNotificationBatch(
  db: Database,
  provider: MailProvider | null,
  limit = 20,
  shouldStop: () => boolean = () => false,
) {
  let delivered = 0;
  for (let index = 0; index < Math.min(limit, 100) && !shouldStop(); index++) {
    const claimToken = uuid();
    // Claim only the message about to be sent, so time spent sending earlier messages
    // cannot expire the leases of messages still waiting in this process.
    const row = (
      await db.query(
        `WITH claim AS (SELECT id FROM notification_message WHERE ((status IN ('PENDING','RETRY') AND available_at<=now()) OR (status='PROCESSING' AND claimed_at<now()-interval '5 minutes')) AND attempts<6 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE notification_message m SET status='PROCESSING',claimed_at=now(),claim_token=$1,attempts=attempts+1 FROM claim WHERE m.id=claim.id RETURNING m.*`,
        [claimToken],
      )
    ).rows[0];
    if (!row) break;
    delivered++;
    try {
      const text = decryptSecret(row.body_ciphertext);
      if (provider)
        await provider.send({
          to: row.recipient,
          subject: row.subject,
          text,
          messageId: `<${row.id}@tapcart.notification>`,
        });
      await db.query(
        "UPDATE notification_message SET status=$3,sent_at=CASE WHEN $3='SENT' THEN now() ELSE NULL END,last_error=NULL,claim_token=NULL WHERE id=$1 AND claim_token=$2",
        [row.id, claimToken, provider ? "SENT" : "CAPTURED"],
      );
    } catch {
      // Provider errors can contain credentials or full message text; retain a safe category only.
      await db.query(
        "UPDATE notification_message SET status=CASE WHEN attempts>=6 THEN 'FAILED' ELSE 'RETRY' END,last_error='Delivery provider failed or is unavailable.',available_at=now()+(LEAST(3600,power(2,attempts)*30)*interval '1 second'),claim_token=NULL WHERE id=$1 AND claim_token=$2",
        [row.id, claimToken],
      );
    }
  }
  // A worker crash on the final attempt must not leave a permanent processing state.
  await db.query(
    "UPDATE notification_message SET status='FAILED',last_error='Delivery lease expired after final attempt.',claim_token=NULL WHERE status='PROCESSING' AND attempts>=6 AND claimed_at<now()-interval '5 minutes'",
  );
  return delivered;
}
export function startNotificationWorker(
  db: Database,
  options: Pick<AppOptions, "production" | "origin">,
) {
  const provider = notificationProvider(options.production);
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = (async () => {
      try {
        await materializeNotificationEvents(db, options.origin);
        await deliverNotificationBatch(db, provider, 20, () => stopped);
      } catch (error) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "Error" },
          "Notification worker failed",
        );
      } finally {
        inFlight = undefined;
      }
    })();
  };
  const timer = setInterval(tick, 5_000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
