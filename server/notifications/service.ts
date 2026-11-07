import { v7 as uuid } from "uuid";
import type { PoolClient } from "pg";
import { encryptSecret } from "../security/crypto.js";
export interface EmailMessage {
  dedupeKey: string;
  recipient: string;
  kind: string;
  subject: string;
  body: string;
  userId?: string;
  storeId?: string;
}
export async function enqueueEmail(client: Pick<PoolClient, "query">, input: EmailMessage) {
  if (!input.recipient || /[\r\n]/.test(input.recipient))
    throw new Error("Invalid email recipient.");
  await client.query(
    `INSERT INTO notification_message(id,dedupe_key,store_id,user_id,recipient,kind,subject,body_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(dedupe_key) DO NOTHING`,
    [
      uuid(),
      input.dedupeKey,
      input.storeId || null,
      input.userId || null,
      input.recipient,
      input.kind,
      input.subject,
      encryptSecret(input.body),
    ],
  );
}
export async function enqueueTeamInvite(
  client: Pick<PoolClient, "query">,
  input: { id: string; storeId: string; email: string; token: string; origin: string },
) {
  if (!input.email) return;
  await enqueueEmail(client, {
    dedupeKey: `invite:${input.id}`,
    storeId: input.storeId,
    recipient: input.email,
    kind: "TEAM_INVITE",
    subject: "Your TapCart team invitation",
    body: `You have been invited to a TapCart store. This invitation expires in seven days.\n${input.origin}/invite/${encodeURIComponent(input.token)}`,
  });
}
