ALTER TABLE product ADD COLUMN supplier_id uuid REFERENCES supplier(id),
 ADD COLUMN lead_time_days integer CHECK(lead_time_days BETWEEN 0 AND 365),
 ADD COLUMN review_days integer NOT NULL DEFAULT 7 CHECK(review_days BETWEEN 1 AND 90),
 ADD COLUMN minimum_stock integer NOT NULL DEFAULT 0 CHECK(minimum_stock BETWEEN 0 AND 1000000);
CREATE TABLE operational_alert (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), fingerprint text NOT NULL,
 kind text NOT NULL, severity text NOT NULL CHECK(severity IN ('HIGH','MEDIUM')), title text NOT NULL,
 evidence jsonb NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','DISMISSED','RESOLVED')),
 reviewed_by uuid REFERENCES app_user(id), note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 UNIQUE(store_id,fingerprint)
);
CREATE TABLE alert_review (
 id uuid PRIMARY KEY, alert_id uuid NOT NULL REFERENCES operational_alert(id), actor_id uuid NOT NULL REFERENCES app_user(id),
 status text NOT NULL, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoice_extraction (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), created_by uuid NOT NULL REFERENCES app_user(id),
 source_name text NOT NULL, source_hash text NOT NULL, engine text NOT NULL, extracted_text text NOT NULL,
 result jsonb NOT NULL, draft_id uuid UNIQUE REFERENCES purchase_draft(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_store_status ON operational_alert(store_id,status,last_seen_at);
CREATE INDEX extraction_store_created ON invoice_extraction(store_id,created_at DESC);
