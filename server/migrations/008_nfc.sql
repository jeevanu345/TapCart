-- Persist encoder/operator session identifiers as audit values without an FK:
-- logout may delete unreferenced sessions; provisioning history must survive.
ALTER TABLE inventory_unit ADD COLUMN IF NOT EXISTS nfc_policy text NOT NULL DEFAULT 'STATIC' CHECK (nfc_policy IN ('STATIC','NTAG424_SDM'));
CREATE TABLE nfc_tag (
 unit_id uuid PRIMARY KEY REFERENCES inventory_unit(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES store(id), uid text UNIQUE NOT NULL CHECK(uid ~ '^[0-9A-F]{14}$'),
 scheme text NOT NULL CHECK(scheme='NTAG424_SDM_AES_PLAIN_EMPTY_MAC'), encrypted_key text NOT NULL,
 last_counter integer NOT NULL DEFAULT -1 CHECK(last_counter BETWEEN -1 AND 16777215),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nfc_provisioning_job (
 id uuid PRIMARY KEY, unit_id uuid NOT NULL REFERENCES inventory_unit(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES store(id), encoder_session_id uuid NOT NULL,
 expected_uri text NOT NULL, status text NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED','WRITTEN','VERIFIED','LOCKED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nfc_provisioning_observation (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES nfc_provisioning_job(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('WRITE_RESOLVED','READ_BACK','LOCK_RESOLVED','FAILURE')),
 observed_uri text, detail text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nfc_field_trial (
 id uuid PRIMARY KEY, trace_id uuid UNIQUE NOT NULL, unit_id uuid NOT NULL REFERENCES inventory_unit(id) ON DELETE CASCADE,
 store_id uuid NOT NULL REFERENCES store(id), operator_session_id uuid NOT NULL,
 device text NOT NULL, tag text NOT NULL, material text NOT NULL, carrier text NOT NULL CHECK(carrier IN ('NFC','QR')),
 outcome text NOT NULL CHECK(outcome IN ('SUCCESS','READ_FAILURE','URI_MISMATCH','RESERVATION_REJECTED','BROWSER_ERROR','CANCELLED')),
 browser_uri_ms double precision CHECK(browser_uri_ms >= 0 AND browser_uri_ms <= 3600000),
 reservation_ms double precision CHECK(reservation_ms >= 0 AND reservation_ms <= 3600000),
 reservation_id uuid, detail text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
