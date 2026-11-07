# NFC encoder, authenticated tags, and field evidence

The encoder supports static NDEF URI writes on a secure context in a browser exposing `NDEFReader` (typically compatible Android Chrome). Every write, scan, and permanent lock starts from an explicit operator button. Create a durable job for a unit; write; remove and present the tag again; compare exactly one URI record against the expected URI; review the successful comparison; optionally check the irreversible-lock confirmation and press the lock button. A mismatch or failed read must never unlock that final step. Browser-reported write completion, read-back, and lock completion are operator/browser observations, not cryptographic proof, physical attachment proof, or independently observed hardware results. Web NFC does not expose tag passwords or low-level SDM personalization.

`POST /api/nfc/jobs` takes `{unitId}`. `POST /api/nfc/jobs/:id/observations` records `WRITE_RESOLVED`, `READ_BACK` (with `observedUri`), `FAILURE`, or `LOCK_RESOLVED` (with `irreversibleLockConfirmed:true`). Jobs bind store, physical unit and encoder session; cross-session observations are rejected. History is durable and available through `GET /api/nfc/jobs/:id`.

## Supported authenticated profile

Only **NTAG424 SDM in AES mode with plaintext 7-byte UID, 3-byte read counter and `SDMMACInputOffset == SDMMACOffset`** is accepted by the production verifier (`NTAG424_SDM_AES_PLAIN_EMPTY_MAC`). It derives the MAC session key with AES-CMAC over `3CC300010080 || UID || counterLE`, CMACs the zero-length input, and retains bytes at indices 1,3,...,15. This is NXP's actual construction, not a substitute HMAC. Encrypted PICC data, nonempty dynamic-file MAC inputs, LRP and TagTamper payloads are not accepted by this endpoint. The underlying MAC primitive has an additional nonempty-input official test vector but that does not expand the supported route profile.

Provision a unique random AES-128 file-read key, UID/counter mirroring, the exact offset profile, and secure hardware key permissions using an NFC hardware encoder that implements NXP personalization commands. This application does not configure those commands through Web NFC. Register the completed hardware configuration with staff `POST /api/nfc/tags`:

```json
{
  "unitId": "<UUID>",
  "uid": "04DE5F1EACC040",
  "sdmFileReadKey": "<32 random hex characters>",
  "profile": "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
  "hardwarePersonalizationConfirmed": true
}
```

The Tags dialog provides an authenticated registration form and safe metadata inspection. Enrollment requires a store **OWNER**, **MANAGER**, or platform **ADMIN**; ordinary staff may inspect the scoped policy and UID but cannot change security policy. `GET /api/nfc/tags/:unitId` returns policy, the caller’s configuration permission, whether server key storage is configured, and safe registration metadata (UID, profile, counter and creation time). It never returns an encrypted key or raw key.

The form requires explicit confirmation that hardware personalization is complete. The AES key uses a password input, never enters React state or browser storage, and is cleared synchronously when submitted. It is sent only to the authenticated enrollment endpoint and encrypted on the server. Failed submissions require re-entering the key; existing registrations cannot be overwritten or reset from the form.

Set `NFC_MASTER_KEY` to 64 cryptographically random hex characters in the server environment. Tag keys are encrypted with AES-256-GCM; authenticated context binds store, unit and UID. Never put the master key or tag keys into browser builds, repository files, logs or ordinary exports. Registration does not expose the key in its response. A live registration cannot be upserted or reset through this API: resetting a replay counter would reopen old payloads. Key rotation and tag replacement require a separately audited operational migration and matching hardware updates.

The tag URI is `/u/<unitId>?uid=<14hex>&ctr=<6hex>&mac=<16hex>`. `ctr` is the tag’s **six-character MSB-first ASCII hexadecimal mirror** (for example `00003D` means 61). The verifier converts it to the three little-endian bytes (`3D0000`) used in cryptographic calculations, as specified in NXP NT4H2421Gx sections 9.3.1 and 9.3.3. Reservation requests carry `tap:{uid,counter,mac}`. The verifier selects the key by physical unit and checks the registered UID and store binding. It atomically accepts only a counter greater than the stored high-water mark; counter advancement and reservation must commit inside the same existing idempotent database transaction. Unknown policies, missing registration, unsupported scheme, unavailable master key, invalid MAC, duplicates and stale counters fail closed. Retries with the original idempotency key replay the stored result. Counter wraparound requires hardware replacement; do not reset the high-water mark.

Cryptographic authenticity confirms possession of the configured tag key at a fresh counter. It does not prevent tag swapping, remote relay, or someone consuming a captured fresh link before its intended shopper. Static URI read-back has none of these cryptographic guarantees.

Sources: [NXP NT4H2421Gx datasheet](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf), [NXP AN12196 rev.2, sections 3.3–3.4, Tables 4–5](https://www.nxp.com/docs/en/application-note/AN12196.pdf), [AES-CMAC package implementation](https://github.com/rosek86/aes-cmac), [NIST SP 800-38B](https://csrc.nist.gov/pubs/sp/800/38/b/upd1/final). Official Table 4 session-key and truncated-MAC vectors and Table 5 nonempty-input vector are executable tests in `server/tests/nfc.test.ts`. The zero factory key is used only in tests and rejected by enrollment.

## Physical measurement support and limits

The staff unit view offers an instrumented NFC trial with device/browser, tag model and attachment material. A trace UUID binds the record. A monotonic browser clock measures start-to-decoded-URI and an authoritative API mutation round trip. The controlled staff endpoint runs the normal reservation and immediate release inside one transaction; the response follows commit. Its timing therefore includes request, reservation, release, commit and response, and is not directly comparable with shopper-only reservation latency. Each result preserves both timings separately. Read timeouts, mismatches, browser errors, reservation failures, and successes are recorded with their outcome and detail. No failure may be silently discarded when calculating reliability.

`POST /api/nfc/field-trials` also accepts carrier `QR`, typed outcomes, nullable failed timings and a trace ID, enabling external instrumented readers to submit observations. Success requires both timings and a reservation ID present in the authoritative unit event stream. `GET /api/nfc/field-trials?unitId=<UUID>` exports all results for the scoped unit. These are browser/operator timing observations backed by a database mutation, not trusted device attestation. Existing `research/field-analysis.ts` supplies Wilson 95% reliability intervals and counts all failed trials in the denominator; group by device, tag, material, carrier and condition, with at least 100 attempts per condition before acceptance conclusions. Use the observed field kit for OS-driven URI launch and QR comparisons: Web NFC timing starts at the operator's button and cannot measure an NFC URI launching a previously closed browser.

**No physical phone, tag or attachment measurements were performed by this implementation task.** No hardware reliability percentage or NFC-to-browser latency is claimed. Actual device trials are outstanding; synthetic and protocol timings must never be labeled physical measurements.
