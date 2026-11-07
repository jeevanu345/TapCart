import type { Express } from "express";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { Database } from "../db.js";
import type { User } from "../types.js";
import { reserve, release, idempotent } from "../protocol.js";
import { enforceTagPolicy } from "../nfc/authenticated.js";
import { json } from "../db.js";
import { requireStore, roles } from "../auth.js";
import { ApiError } from "../errors.js";
import { summarizeTrials, type FieldTrial } from "../nfc/measurements.js";
import { uuidValue } from "./shared.js";
import { encryptTagKey, masterKey } from "../nfc/authenticated.js";
export interface NfcOptions {
  origin: string;
  nfcMasterKey?: string;
}
export const canConfigureNfc = (user: User) =>
  user.role === "ADMIN" ||
  (user.role === "STORE" && ["OWNER", "MANAGER"].includes(user.storeRole || ""));
const label = z.string().trim().min(1).max(200);
const duration = z.number().min(0).max(3_600_000).nullable();
export function registerNfcRoutes(app: Express, db: Database, options: NfcOptions) {
  const origin = new URL(options.origin).origin;
  async function scopedUnit(unitId: string, user: User) {
    const unit = (
      await db.query("SELECT id,store_id,nfc_policy FROM inventory_unit WHERE id=$1", [unitId])
    ).rows[0];
    if (!unit) throw new ApiError(404, "Unit not found.");
    await requireStore(db, user, unit.store_id);
    return unit;
  }
  app.post("/api/nfc/jobs", roles("STORE", "ADMIN"), async (req, res) => {
    const { unitId } = z.object({ unitId: uuidValue }).parse(req.body),
      unit = await scopedUnit(unitId, req.auth!.user);
    if (unit.nfc_policy !== "STATIC")
      throw new ApiError(
        409,
        "Use the hardware SDM encoder for authenticated tags; static rewriting is disabled.",
      );
    if (unit.nfc_policy !== "STATIC")
      throw new ApiError(
        409,
        "Use an authenticated hardware encoder to personalize SDM tags; Web NFC writes static NDEF only.",
      );
    const row = (
      await db.query(
        "INSERT INTO nfc_provisioning_job(id,unit_id,store_id,encoder_session_id,expected_uri) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [uuid(), unitId, unit.store_id, req.auth!.sessionId, `${origin}/u/${unitId}`],
      )
    ).rows[0];
    res.status(201).json(json(row));
  });
  app.get("/api/nfc/jobs/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const row = (
      await db.query("SELECT * FROM nfc_provisioning_job WHERE id=$1", [
        uuidValue.parse(req.params.id),
      ])
    ).rows[0];
    if (!row) throw new ApiError(404, "Job not found.");
    await requireStore(db, req.auth!.user, row.store_id);
    res.json({
      ...json(row),
      observations: json(
        (
          await db.query(
            "SELECT * FROM nfc_provisioning_observation WHERE job_id=$1 ORDER BY created_at,id",
            [row.id],
          )
        ).rows,
      ),
    });
  });
  app.post("/api/nfc/jobs/:id/observations", roles("STORE", "ADMIN"), async (req, res) => {
    const input = z
      .object({
        kind: z.enum(["WRITE_RESOLVED", "READ_BACK", "LOCK_RESOLVED", "FAILURE"]),
        observedUri: z.string().max(2048).optional(),
        detail: z.string().max(500).default(""),
        irreversibleLockConfirmed: z.boolean().optional(),
      })
      .parse(req.body);
    const result = await db.transaction(async (client) => {
      const row = (
        await client.query("SELECT * FROM nfc_provisioning_job WHERE id=$1 FOR UPDATE", [
          uuidValue.parse(req.params.id),
        ])
      ).rows[0];
      if (!row || row.encoder_session_id !== req.auth!.sessionId)
        throw new ApiError(404, "Job not found for this encoder session.");
      await requireStore(db, req.auth!.user, row.store_id);
      let status = row.status;
      if (input.kind === "WRITE_RESOLVED") {
        if (status !== "CREATED") throw new ApiError(409, "Create a new job before writing again.");
        status = "WRITTEN";
      }
      if (input.kind === "READ_BACK") {
        if (status !== "WRITTEN") throw new ApiError(409, "Read back only after write completion.");
        status = input.observedUri === row.expected_uri ? "VERIFIED" : "FAILED";
      }
      if (input.kind === "LOCK_RESOLVED") {
        if (status !== "VERIFIED" || input.irreversibleLockConfirmed !== true)
          throw new ApiError(
            409,
            "Verify exact URI and explicitly confirm irreversible locking first.",
          );
        status = "LOCKED";
      }
      if (input.kind === "FAILURE") status = "FAILED";
      await client.query(
        "INSERT INTO nfc_provisioning_observation(id,job_id,kind,observed_uri,detail) VALUES($1,$2,$3,$4,$5)",
        [uuid(), row.id, input.kind, input.observedUri ?? null, input.detail],
      );
      return (
        await client.query(
          "UPDATE nfc_provisioning_job SET status=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [row.id, status],
        )
      ).rows[0];
    });
    res.json({ ...json(result), evidence: "OPERATOR_BROWSER_OBSERVATION" });
  });
  app.get("/api/nfc/tags/:unitId", roles("STORE", "ADMIN"), async (req, res) => {
    const unit = await scopedUnit(uuidValue.parse(req.params.unitId), req.auth!.user);
    const tag = (
      await db.query(
        "SELECT uid,scheme,last_counter,created_at FROM nfc_tag WHERE unit_id=$1 AND store_id=$2",
        [unit.id, unit.store_id],
      )
    ).rows[0];
    res.json({
      unitId: unit.id,
      policy: unit.nfc_policy,
      canConfigure: canConfigureNfc(req.auth!.user),
      keyStorageConfigured: /^[0-9a-fA-F]{64}$/.test(
        options.nfcMasterKey ?? process.env.NFC_MASTER_KEY ?? "",
      ),
      registration: tag ? json(tag) : null,
    });
  });
  app.post("/api/nfc/tags", roles("STORE", "ADMIN"), async (req, res) => {
    if (!canConfigureNfc(req.auth!.user))
      throw new ApiError(
        403,
        "Only a store owner, manager, or administrator can configure authenticated NFC tags.",
      );
    const input = z
      .object({
        unitId: uuidValue,
        uid: z
          .string()
          .regex(/^[0-9A-Fa-f]{14}$/)
          .transform((x) => x.toUpperCase()),
        sdmFileReadKey: z.string().regex(/^[0-9A-Fa-f]{32}$/),
        profile: z.literal("NTAG424_SDM_AES_PLAIN_EMPTY_MAC"),
        hardwarePersonalizationConfirmed: z.literal(true),
      })
      .parse(req.body);
    const unit = await scopedUnit(input.unitId, req.auth!.user),
      master = masterKey(options.nfcMasterKey ?? process.env.NFC_MASTER_KEY);
    if (/^0{32}$/.test(input.sdmFileReadKey))
      throw new ApiError(
        400,
        "Factory zero keys are test vectors only; provision a unique random per-tag key.",
      );
    const encrypted = encryptTagKey(
      Buffer.from(input.sdmFileReadKey, "hex"),
      master,
      `${unit.store_id}:${unit.id}:${input.uid}`,
    );
    await db.transaction(async (client) => {
      const locked = (
        await client.query(
          "SELECT store_id,nfc_policy FROM inventory_unit WHERE id=$1 FOR UPDATE",
          [unit.id],
        )
      ).rows[0];
      if (!locked || locked.store_id !== unit.store_id)
        throw new ApiError(409, "Unit scope changed; refresh before registration.");
      if (locked.nfc_policy !== "STATIC")
        throw new ApiError(
          409,
          "This unit already requires an authenticated tag; registration cannot be reset.",
        );
      const existing = await client.query(
        "SELECT unit_id FROM nfc_tag WHERE unit_id=$1 FOR UPDATE",
        [unit.id],
      );
      if (existing.rowCount)
        throw new ApiError(
          409,
          "An authenticated tag is already registered for this physical unit.",
        );
      // No upsert: resetting a live counter would reopen captured links. Replacement is an audited hardware operation outside this API.
      await client.query(
        "INSERT INTO nfc_tag(unit_id,store_id,uid,scheme,encrypted_key) VALUES($1,$2,$3,$4,$5)",
        [unit.id, unit.store_id, input.uid, input.profile, encrypted],
      );
      await client.query("UPDATE inventory_unit SET nfc_policy='NTAG424_SDM' WHERE id=$1", [
        unit.id,
      ]);
    });
    res
      .status(201)
      .json({ unitId: unit.id, uid: input.uid, policy: "NTAG424_SDM", profile: input.profile });
  });
  app.post("/api/nfc/field-reservations", roles("STORE", "ADMIN"), async (req, res) => {
    const input = z
      .object({
        unitId: uuidValue,
        version: z.number().int().nonnegative(),
        tap: z.object({ uid: z.string(), counter: z.string(), mac: z.string() }).optional(),
      })
      .parse(req.body);
    await scopedUnit(input.unitId, req.auth!.user);
    const result = await idempotent(
      db,
      `field-reserve:${req.auth!.sessionId}`,
      req.get("Idempotency-Key"),
      input,
      async (client) => {
        await enforceTagPolicy(client, input.unitId, input.tap, options.nfcMasterKey);
        const result = await reserve(client, req.auth!, input),
          body = result.body as { reservationId: string; version: number };
        await release(client, req.auth!, body.reservationId, body.version);
        return result;
      },
    );
    res.status(result.status).json(result.body);
  });
  app.post("/api/nfc/field-trials", roles("STORE", "ADMIN"), async (req, res) => {
    const input = z
      .object({
        traceId: uuidValue,
        unitId: uuidValue,
        device: label,
        tag: label,
        material: label,
        carrier: z.enum(["NFC", "QR"]),
        outcome: z.enum([
          "SUCCESS",
          "READ_FAILURE",
          "URI_MISMATCH",
          "RESERVATION_REJECTED",
          "BROWSER_ERROR",
          "CANCELLED",
        ]),
        browserUriMs: duration,
        reservationMs: duration,
        reservationId: uuidValue.nullable(),
        detail: z.string().max(500).default(""),
      })
      .parse(req.body);
    const unit = await scopedUnit(input.unitId, req.auth!.user);
    if (
      input.outcome === "SUCCESS" &&
      (input.browserUriMs === null || input.reservationMs === null || !input.reservationId)
    )
      throw new ApiError(
        400,
        "Success requires URI timing and an authoritative reservation result.",
      );
    if (input.reservationId) {
      const valid = await db.query(
        "SELECT 1 FROM outbox WHERE event_type='InventoryReserved' AND aggregate_id=$1 AND payload->>'reservationId'=$2",
        [unit.id, input.reservationId],
      );
      if (!valid.rowCount)
        throw new ApiError(400, "Reservation is not recorded for this physical unit.");
    }
    const row = (
      await db.query(
        "INSERT INTO nfc_field_trial(id,trace_id,unit_id,store_id,operator_session_id,device,tag,material,carrier,outcome,browser_uri_ms,reservation_ms,reservation_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",
        [
          uuid(),
          input.traceId,
          unit.id,
          unit.store_id,
          req.auth!.sessionId,
          input.device,
          input.tag,
          input.material,
          input.carrier,
          input.outcome,
          input.browserUriMs,
          input.reservationMs,
          input.reservationId,
          input.detail,
        ],
      )
    ).rows[0];
    res.status(201).json(json(row));
  });
  app.get("/api/nfc/field-trials/summary", roles("STORE", "ADMIN"), async (req, res) => {
    const unit = await scopedUnit(uuidValue.parse(req.query.unitId), req.auth!.user);
    const trials = (
      await db.query(
        "SELECT device,tag,material,carrier,outcome,browser_uri_ms,reservation_ms FROM nfc_field_trial WHERE unit_id=$1",
        [unit.id],
      )
    ).rows as FieldTrial[];
    res.json(summarizeTrials(trials));
  });
  app.get("/api/nfc/field-trials", roles("STORE", "ADMIN"), async (req, res) => {
    const unit = await scopedUnit(uuidValue.parse(req.query.unitId), req.auth!.user);
    res.json(
      json(
        (
          await db.query("SELECT * FROM nfc_field_trial WHERE unit_id=$1 ORDER BY created_at", [
            unit.id,
          ])
        ).rows,
      ),
    );
  });
}
