# Migrating existing installations

The previous implementation treated SKUs as quantities and had no physical-unit, reservation, sale epoch, payment-event or durable-idempotency records. Its schema cannot be silently converted into the paper's protocol without decisions about real units and old payment evidence.

1. Take a verified backup of the old database. Record outstanding orders, stock counts, discounts and payment evidence. Keep the old deployment read-only during cutover.
2. Create a **new** PostgreSQL database and run this version's migrations. Never point the development seed or test database URL at production.
3. Create the first administrator using `db:create-admin` and operator-provided credentials. Register/approve stores through the app; recreate passwords through a controlled enrollment process rather than importing legacy unsalted hashes.
4. Export active catalog records as CSV with sku,name,category,price,quantity,description. Prices are INR major units in CSV and paise internally. Reconcile the physical count. Import each approved store's catalog. Each imported unit receives a new UUIDv7.
5. Provision a separate NFC/QR HTTPS URI per physical unit from Tag studio, write/read-back/compare the manifest, lock tags, attach and verify product binding. Old SKU links do not identify one physical unit and cannot be mapped safely by guessing.
6. Complete/refund historical orders in the old system using real settlement evidence. Retain historical invoices read-only; do not manufacture sales or mark new orders paid to mimic history. This rebuild intentionally does not auto-import unverifiable legacy payments.
7. Configure the final HTTPS APP_ORIGIN, payment callbacks if used, workers, monitoring and backup policy. Test customer reservation, checkout, receipt, expiry and refund before switching traffic. Keep an explicit rollback window and source database backup.

OTP/SMS and emailed receipt links from the old implementation are replaced by authenticated customer accounts and authorized receipts. No SMS or email is promised or sent by this rebuild. Add a verified delivery integration through the outbox if the deployment requires messaging. Existing static NFC links remain identifiers, not proof of authenticity.
