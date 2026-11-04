CREATE TABLE app_user (
 id uuid PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('ADMIN','STORE','CUSTOMER')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store (
 id uuid PRIMARY KEY, owner_id uuid UNIQUE NOT NULL REFERENCES app_user(id), name text NOT NULL, address text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DENIED')), approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE session (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id), token_hash text UNIQUE NOT NULL,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_expiry ON session(expires_at);
CREATE TABLE product (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES store(id), sku text NOT NULL, name text NOT NULL,
 description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'General', price_cents integer NOT NULL CHECK(price_cents>=0),
 image_url text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(store_id,sku), UNIQUE(id,store_id)
);
CREATE TABLE customer_order (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id), owner_session_id uuid NOT NULL REFERENCES session(id), store_id uuid NOT NULL REFERENCES store(id),
 status text NOT NULL CHECK(status IN ('PAYMENT_PENDING','PAYMENT_FAILED','PAID','COMPLETED','REFUND_PENDING','REFUNDED')),
 payment_method text NOT NULL CHECK(payment_method IN ('DESK','DEVELOPMENT','CARD')), total_cents integer NOT NULL CHECK(total_cents>=0), refund_due_cents integer NOT NULL DEFAULT 0 CHECK(refund_due_cents>=0), refunded_cents integer NOT NULL DEFAULT 0 CHECK(refunded_cents>=0),
 payment_reference text UNIQUE, failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, completed_at timestamptz, UNIQUE(id,store_id)
);
CREATE TABLE inventory_unit (
 id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES product(id), store_id uuid NOT NULL REFERENCES store(id), staff_code text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','RESERVED','SOLD')),
 reservation_id uuid UNIQUE, owner_session_id uuid REFERENCES session(id), reserved_until timestamptz,
 checkout_order_id uuid REFERENCES customer_order(id), checkout_protected_until timestamptz,
 sold_order_id uuid REFERENCES customer_order(id), sold_at timestamptz, sale_epoch integer NOT NULL DEFAULT 0 CHECK(sale_epoch>=0),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(product_id,store_id) REFERENCES product(id,store_id),
 FOREIGN KEY(checkout_order_id,store_id) REFERENCES customer_order(id,store_id),
 FOREIGN KEY(sold_order_id,store_id) REFERENCES customer_order(id,store_id),
 CHECK (
 (status='AVAILABLE' AND reservation_id IS NULL AND owner_session_id IS NULL AND reserved_until IS NULL AND sold_order_id IS NULL AND sold_at IS NULL AND checkout_order_id IS NULL AND checkout_protected_until IS NULL) OR
 (status='RESERVED' AND reservation_id IS NOT NULL AND owner_session_id IS NOT NULL AND reserved_until IS NOT NULL AND sold_order_id IS NULL AND sold_at IS NULL AND ((checkout_order_id IS NULL AND checkout_protected_until IS NULL) OR (checkout_order_id IS NOT NULL AND checkout_protected_until IS NOT NULL))) OR
 (status='SOLD' AND reservation_id IS NULL AND owner_session_id IS NULL AND reserved_until IS NULL AND sold_order_id IS NOT NULL AND sold_at IS NOT NULL AND checkout_order_id IS NULL AND checkout_protected_until IS NULL))
);
CREATE INDEX inventory_expiry ON inventory_unit(reserved_until) WHERE status='RESERVED';
CREATE INDEX inventory_store_status ON inventory_unit(store_id,status);
CREATE TABLE order_unit (
 order_id uuid NOT NULL REFERENCES customer_order(id), unit_id uuid NOT NULL REFERENCES inventory_unit(id),
 product_id uuid NOT NULL REFERENCES product(id), reservation_id uuid NOT NULL, protected_version bigint NOT NULL,
 sale_epoch integer NOT NULL, name text NOT NULL, sku text NOT NULL, price_cents integer NOT NULL CHECK(price_cents>=0),
 returned_at timestamptz, return_reason text, PRIMARY KEY(order_id,unit_id)
);
CREATE TABLE unit_sale (
 unit_id uuid NOT NULL REFERENCES inventory_unit(id), sale_epoch integer NOT NULL, order_id uuid NOT NULL REFERENCES customer_order(id),
 price_cents integer NOT NULL, sold_at timestamptz NOT NULL DEFAULT now(), returned_at timestamptz, PRIMARY KEY(unit_id,sale_epoch)
);
CREATE TABLE idempotency_record (
 scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response jsonb, status_code integer,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
CREATE TABLE payment_event (
 event_id text PRIMARY KEY, order_id uuid NOT NULL REFERENCES customer_order(id), outcome text NOT NULL CHECK(outcome IN ('SUCCEEDED','FAILED')),
 source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY, event_type text NOT NULL, aggregate_id uuid NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE order_refund (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES customer_order(id), amount_cents integer NOT NULL CHECK(amount_cents>0), source text NOT NULL, confirmed_by uuid REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now());
