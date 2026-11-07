CREATE TABLE supplier (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), name text NOT NULL,
 email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '', lead_time_days integer NOT NULL DEFAULT 7 CHECK(lead_time_days BETWEEN 0 AND 365), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,store_id)
);
CREATE TABLE purchase_draft (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), supplier_id uuid,
 invoice_number text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', lines jsonb NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(supplier_id,store_id) REFERENCES supplier(id,store_id)
);
CREATE TABLE purchase_order (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), supplier_id uuid NOT NULL,
 draft_id uuid UNIQUE REFERENCES purchase_draft(id), invoice_number text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','RECEIVED')),
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,store_id), FOREIGN KEY(supplier_id,store_id) REFERENCES supplier(id,store_id)
);
CREATE TABLE purchase_order_line (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES purchase_order(id), product_id uuid NOT NULL REFERENCES product(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000), received_quantity integer NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
 unit_cost_cents integer NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 100000000), UNIQUE(order_id,product_id)
);
CREATE TABLE purchase_receipt (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES purchase_order(id), received_by uuid NOT NULL REFERENCES app_user(id),
 reference text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchase_receipt_line (
 receipt_id uuid NOT NULL REFERENCES purchase_receipt(id), line_id uuid NOT NULL REFERENCES purchase_order_line(id),
 quantity integer NOT NULL CHECK(quantity>0), PRIMARY KEY(receipt_id,line_id)
);
ALTER TABLE inventory_unit ADD COLUMN unit_cost_cents integer CHECK(unit_cost_cents>=0),
 ADD COLUMN purchase_receipt_id uuid REFERENCES purchase_receipt(id);
CREATE TABLE coupon (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), code text NOT NULL,
 type text NOT NULL CHECK(type IN ('PERCENT','FIXED')), value integer NOT NULL CHECK(value>0),
 minimum_spend_cents integer NOT NULL DEFAULT 0 CHECK(minimum_spend_cents>=0),
 starts_at timestamptz, expires_at timestamptz, max_uses integer CHECK(max_uses>0),
 per_customer_limit integer CHECK(per_customer_limit>0), uses integer NOT NULL DEFAULT 0 CHECK(uses>=0),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(type!='PERCENT' OR value<=100), CHECK(expires_at IS NULL OR starts_at IS NULL OR expires_at>starts_at),
 CHECK(code=upper(code)), UNIQUE(store_id,code), UNIQUE(id,store_id)
);
CREATE TABLE coupon_redemption (
 order_id uuid PRIMARY KEY REFERENCES customer_order(id), coupon_id uuid NOT NULL REFERENCES coupon(id),
 user_id uuid NOT NULL REFERENCES app_user(id), discount_cents integer NOT NULL CHECK(discount_cents>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemption_customer ON coupon_redemption(coupon_id,user_id);
ALTER TABLE customer_order ADD COLUMN subtotal_cents integer CHECK(subtotal_cents>=0),
 ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK(discount_cents>=0), ADD COLUMN coupon_code text;
UPDATE customer_order SET subtotal_cents=total_cents;
ALTER TABLE order_unit ADD COLUMN list_price_cents integer CHECK(list_price_cents>=0),
 ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK(discount_cents>=0);
UPDATE order_unit SET list_price_cents=price_cents;
CREATE INDEX purchase_order_store ON purchase_order(store_id,created_at DESC);
CREATE INDEX purchase_draft_store ON purchase_draft(store_id,created_at DESC);
