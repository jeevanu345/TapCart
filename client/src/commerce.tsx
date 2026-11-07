import { Select } from "./select";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "./App";
import {
  api,
  date,
  message,
  money,
  shortId,
  useData,
  write,
  type Product,
  type Store,
} from "./api";
import { Button, Empty, ErrorState, Loading, PageTitle, Panel, Status, useNotify } from "./ui";

interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  leadTimeDays: number;
  active: boolean;
}
interface DraftLine {
  productId: string;
  quantity: number;
  unitCostCents: number;
}
interface Draft {
  id: string;
  supplierId: string | null;
  supplierName?: string;
  invoiceNumber: string;
  notes: string;
  lines: DraftLine[];
  status: string;
  createdAt: string;
}
interface PurchaseLine extends DraftLine {
  id: string;
  name: string;
  sku: string;
  receivedQuantity: number;
}
interface Purchase {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  status: string;
  createdAt: string;
  lines: PurchaseLine[];
  receipts: {
    id: string;
    reference: string;
    createdAt: string;
    lines: { lineId: string; quantity: number }[];
  }[];
}
interface Coupon {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minimumSpendCents: number;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  perCustomerLimit: number | null;
  uses: number;
  active: boolean;
}
function useCommerceScope() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const stores = useData<Store[]>(user?.role === "ADMIN" ? "/stores" : null);
  const storeId = user?.role === "ADMIN" ? params.get("storeId") || "" : user?.storeId || "";
  const path = (url: string) =>
    user?.role === "ADMIN"
      ? `${url}${url.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`
      : url;
  const picker =
    user?.role === "ADMIN" ? (
      <label>
        Store
        <Select
          aria-label="Store for commerce"
          value={storeId}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set("storeId", value);
            next.delete("draft");
            setParams(next);
          }}
        >
          <option value="">Choose an approved store</option>
          {stores.data
            ?.filter((store) => store.status === "APPROVED")
            .map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
        </Select>
      </label>
    ) : null;
  return {
    storeId,
    path,
    picker,
    manage: user?.role === "ADMIN" || user?.storeRole === "OWNER" || user?.storeRole === "MANAGER",
  };
}
// Keeps the same idempotency key after a failed request so a network retry cannot duplicate a receipt.
function useRequestKey() {
  const previous = useRef<{ signature: string; key: string } | null>(null);
  return (input: unknown) => {
    const signature = JSON.stringify(input);
    if (previous.current?.signature !== signature)
      previous.current = { signature, key: crypto.randomUUID() };
    return previous.current.key;
  };
}
export function Suppliers() {
  const scope = useCommerceScope(),
    suppliers = useData<Supplier[]>(scope.storeId ? scope.path("/suppliers") : null);
  const [editing, setEditing] = useState<Supplier | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRequestKey(),
    notify = useNotify();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name")),
      email: String(form.get("email")),
      phone: String(form.get("phone")),
      address: String(form.get("address")),
      notes: String(form.get("notes")),
      leadTimeDays: Number(form.get("leadTimeDays")),
      active: form.get("active") === "on",
    };
    setBusy(true);
    setError("");
    try {
      await write(
        scope.path(editing ? `/suppliers/${editing.id}` : "/suppliers"),
        body,
        editing ? "PATCH" : "POST",
        key(body),
      );
      setOpen(false);
      suppliers.reload();
      notify("Supplier saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Suppliers"
        description="Contacts and delivery lead times for purchasing."
        actions={
          <>
            {scope.picker}
            {scope.manage && scope.storeId && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                  setError("");
                }}
              >
                Add supplier
              </Button>
            )}
          </>
        }
      />
      {open && (
        <Panel title={editing ? "Edit supplier" : "New supplier"}>
          <form key={editing?.id || "new"} className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Name
                <input name="name" required maxLength={200} defaultValue={editing?.name} />
              </label>
              <label>
                Email
                <input name="email" type="email" defaultValue={editing?.email} />
              </label>
              <label>
                Phone
                <input name="phone" defaultValue={editing?.phone} />
              </label>
              <label>
                Lead time in days
                <input
                  name="leadTimeDays"
                  type="number"
                  min={0}
                  max={365}
                  required
                  defaultValue={editing?.leadTimeDays ?? 7}
                />
              </label>
              <label className="span-2">
                Address
                <input name="address" defaultValue={editing?.address} />
              </label>
              <label className="span-2">
                Notes
                <textarea name="notes" maxLength={3000} defaultValue={editing?.notes} />
              </label>
              <label>
                <input name="active" type="checkbox" defaultChecked={editing?.active ?? true} />{" "}
                Active supplier
              </label>
            </div>
            {error && <ErrorState error={error} />}
            <div className="actions">
              <Button type="submit" busy={busy}>
                Save supplier
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Supplier directory">
        {!scope.storeId ? (
          <Empty title="Choose a store" detail="Select a store to manage its suppliers." />
        ) : suppliers.loading ? (
          <Loading />
        ) : suppliers.error ? (
          <ErrorState error={suppliers.error} retry={suppliers.reload} />
        ) : suppliers.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th>Lead time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.data.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.name}</strong>
                      <small>{supplier.address}</small>
                    </td>
                    <td>
                      {supplier.email}
                      <small>{supplier.phone}</small>
                    </td>
                    <td>{supplier.leadTimeDays} days</td>
                    <td>
                      <Status value={supplier.active ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td>
                      {scope.manage && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditing(supplier);
                            setOpen(true);
                            setError("");
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No suppliers yet"
            detail="Add a supplier before approving your first purchase order."
          />
        )}
      </Panel>
    </>
  );
}
export function Purchasing() {
  const scope = useCommerceScope(),
    [params, setParams] = useSearchParams();
  const suppliers = useData<Supplier[]>(scope.storeId ? scope.path("/suppliers") : null),
    products = useData<Product[]>(scope.storeId ? scope.path("/products") : null),
    drafts = useData<Draft[]>(scope.storeId ? scope.path("/purchasing/drafts") : null),
    orders = useData<Purchase[]>(scope.storeId ? scope.path("/purchasing/orders") : null);
  const selectedDraft = useData<Draft>(
    scope.storeId && params.get("draft")
      ? scope.path(`/purchasing/drafts/${params.get("draft")}`)
      : null,
  );
  const [draftId, setDraftId] = useState(""),
    [supplierId, setSupplierId] = useState(""),
    [invoiceNumber, setInvoiceNumber] = useState(""),
    [notes, setNotes] = useState(""),
    [lines, setLines] = useState<DraftLine[]>([{ productId: "", quantity: 1, unitCostCents: 0 }]),
    [editing, setEditing] = useState(false),
    [selectedOrder, setSelectedOrder] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRequestKey(),
    notify = useNotify();
  useEffect(() => {
    if (selectedDraft.data && selectedDraft.data.status === "DRAFT") {
      const draft = selectedDraft.data;
      setDraftId(draft.id);
      setSupplierId(draft.supplierId || "");
      setInvoiceNumber(draft.invoiceNumber);
      setNotes(draft.notes);
      setLines(draft.lines);
      setEditing(true);
    }
  }, [selectedDraft.data]);
  function newDraft() {
    setDraftId("");
    setSupplierId("");
    setInvoiceNumber("");
    setNotes("");
    setLines([{ productId: "", quantity: 1, unitCostCents: 0 }]);
    setEditing(true);
    setError("");
    const next = new URLSearchParams(params);
    next.delete("draft");
    setParams(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = { supplierId: supplierId || undefined, invoiceNumber, notes, lines };
    try {
      const result = await write<Draft>(
        scope.path(draftId ? `/purchasing/drafts/${draftId}` : "/purchasing/drafts"),
        body,
        draftId ? "PATCH" : "POST",
        key(body),
      );
      setDraftId(result.id);
      drafts.reload();
      notify("Draft saved. Review its lines before approval.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    setBusy(true);
    setError("");
    try {
      const order = await write<Purchase>(
        scope.path(`/purchasing/drafts/${draftId}/approve`),
        {},
        "POST",
        key({ approve: draftId }),
      );
      orders.reload();
      drafts.reload();
      setSelectedOrder(order.id);
      setEditing(false);
      notify("Purchase order approved. Receive goods when they arrive.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const order = orders.data?.find((entry) => entry.id === selectedOrder);
  return (
    <>
      <PageTitle
        title="Purchasing"
        description="Review invoice drafts, approve orders and receive physical units."
        actions={
          <>
            {scope.picker}
            {scope.manage && scope.storeId && (
              <Button onClick={newDraft}>New purchase draft</Button>
            )}
          </>
        }
      />
      {(error || selectedDraft.error) && <ErrorState error={error || selectedDraft.error} />}
      {editing && scope.manage && (
        <Panel
          title="Review purchase draft"
          subtitle="Saving and approving do not create stock. Receive goods in a separate action."
        >
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Supplier
                <Select
                  aria-label="Supplier"
                  value={supplierId}
                  onValueChange={(value) => setSupplierId(value)}
                >
                  <option value="">Choose a supplier</option>
                  {suppliers.data
                    ?.filter((entry) => entry.active)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                </Select>
              </label>
              <label>
                Invoice number
                <input
                  value={invoiceNumber}
                  maxLength={200}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
              </label>
              <label className="span-2">
                Notes
                <textarea
                  maxLength={3000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
            {products.error && <ErrorState error={products.error} retry={products.reload} />}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Catalog product</th>
                    <th>Quantity</th>
                    <th>Unit cost (paise)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <Select
                          required
                          aria-label={`Product for line ${index + 1}`}
                          value={line.productId}
                          onValueChange={(value) =>
                            setLines(
                              lines.map((old, i) =>
                                i === index ? { ...old, productId: value } : old,
                              ),
                            )
                          }
                        >
                          <option value="">Match a catalog product</option>
                          {products.data
                            ?.filter((product) => product.active)
                            .map((product) => (
                              <option value={product.id} key={product.id}>
                                {product.name} · {product.sku}
                              </option>
                            ))}
                        </Select>
                      </td>
                      <td>
                        <input
                          aria-label={`Quantity for line ${index + 1}`}
                          type="number"
                          required
                          min={1}
                          max={10000}
                          value={line.quantity}
                          onChange={(e) =>
                            setLines(
                              lines.map((old, i) =>
                                i === index ? { ...old, quantity: Number(e.target.value) } : old,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Unit cost for line ${index + 1}`}
                          type="number"
                          required
                          min={0}
                          max={100000000}
                          value={line.unitCostCents}
                          onChange={(e) =>
                            setLines(
                              lines.map((old, i) =>
                                i === index
                                  ? { ...old, unitCostCents: Number(e.target.value) }
                                  : old,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          disabled={lines.length === 1}
                          onClick={() => setLines(lines.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <strong>
              Draft cost:{" "}
              {money(lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0))}
            </strong>
            <div className="actions">
              <Button
                variant="secondary"
                onClick={() =>
                  setLines([...lines, { productId: "", quantity: 1, unitCostCents: 0 }])
                }
              >
                Add line
              </Button>
              <Button type="submit" busy={busy}>
                Save reviewed draft
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Close
              </Button>
            </div>
          </form>
          {draftId && (
            <div className="actions">
              <p>Approval uses the saved draft. Save any edited fields first.</p>
              <Button busy={busy} disabled={!supplierId} onClick={approve}>
                Approve saved draft as purchase order
              </Button>
            </div>
          )}
        </Panel>
      )}
      <Panel title="Invoice drafts">
        {drafts.loading && scope.storeId ? (
          <Loading />
        ) : drafts.error ? (
          <ErrorState error={drafts.error} retry={drafts.reload} />
        ) : drafts.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Supplier</th>
                  <th>Lines</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {drafts.data.map((draft) => (
                  <tr key={draft.id}>
                    <td>{draft.invoiceNumber || shortId(draft.id)}</td>
                    <td>{draft.supplierName || "Choose supplier"}</td>
                    <td>{draft.lines.length}</td>
                    <td>
                      <Status value={draft.status} />
                    </td>
                    <td>
                      {scope.manage && draft.status === "DRAFT" && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set("draft", draft.id);
                            setParams(next);
                          }}
                        >
                          Review draft
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No purchase drafts"
            detail="Create a draft or extract an invoice in Intelligence."
          />
        )}
      </Panel>
      <Panel title="Purchase orders">
        {orders.loading && scope.storeId ? (
          <Loading />
        ) : orders.error ? (
          <ErrorState error={orders.error} retry={orders.reload} />
        ) : orders.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Supplier</th>
                  <th>Received units</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>
                      {purchase.invoiceNumber || shortId(purchase.id)}
                      <small>{date(purchase.createdAt)}</small>
                    </td>
                    <td>{purchase.supplierName}</td>
                    <td>
                      {purchase.lines.reduce((sum, line) => sum + line.receivedQuantity, 0)} /{" "}
                      {purchase.lines.reduce((sum, line) => sum + line.quantity, 0)}
                    </td>
                    <td>
                      <Status value={purchase.status} />
                    </td>
                    <td>
                      <Button variant="secondary" onClick={() => setSelectedOrder(purchase.id)}>
                        View and receive
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No purchase orders" detail="Approve a reviewed draft to create an order." />
        )}
      </Panel>
      {order && (
        <ReceiptEditor
          key={order.id}
          purchase={order}
          manage={scope.manage}
          path={scope.path}
          onReceived={() => {
            orders.reload();
            notify("Receipt saved and physical inventory created.");
          }}
        />
      )}
    </>
  );
}
function ReceiptEditor({
  purchase,
  manage,
  path,
  onReceived,
}: {
  purchase: Purchase;
  manage: boolean;
  path: (url: string) => string;
  onReceived: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({}),
    [reference, setReference] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRequestKey();
  async function receive(event: FormEvent) {
    event.preventDefault();
    const body = {
      reference,
      lines: purchase.lines
        .filter((line) => (quantities[line.id] || 0) > 0)
        .map((line) => ({ lineId: line.id, quantity: quantities[line.id] })),
    };
    setBusy(true);
    setError("");
    try {
      await write(
        path(`/purchasing/orders/${purchase.id}/receive`),
        body,
        "POST",
        key({
          purchaseId: purchase.id,
          received: purchase.lines.map((line) => line.receivedQuantity),
          ...body,
        }),
      );
      setQuantities({});
      setReference("");
      onReceived();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={`Receive ${purchase.invoiceNumber || shortId(purchase.id)}`}
      subtitle="Each received item creates its own available unit and records its purchase cost."
    >
      <form className="form-stack" onSubmit={receive}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Ordered</th>
                <th>Received</th>
                <th>Unit cost</th>
                <th>Receive now</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.name}
                    <small>{line.sku}</small>
                  </td>
                  <td>{line.quantity}</td>
                  <td>{line.receivedQuantity}</td>
                  <td>{money(line.unitCostCents)}</td>
                  <td>
                    <input
                      aria-label={`Receive ${line.name}`}
                      type="number"
                      min={0}
                      max={line.quantity - line.receivedQuantity}
                      disabled={!manage || line.quantity === line.receivedQuantity}
                      value={quantities[line.id] || 0}
                      onChange={(e) =>
                        setQuantities({ ...quantities, [line.id]: Number(e.target.value) })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label>
          Receipt reference
          <input maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {error && <ErrorState error={error} />}
        <Button
          type="submit"
          busy={busy}
          disabled={!manage || !Object.values(quantities).some((n) => n > 0)}
        >
          Confirm received units
        </Button>
      </form>
      {purchase.receipts.length > 0 && (
        <>
          <h3>Receipt history</h3>
          {purchase.receipts.map((receipt) => (
            <p key={receipt.id}>
              {receipt.reference || shortId(receipt.id)} · {date(receipt.createdAt)} ·{" "}
              {receipt.lines.reduce((sum, line) => sum + line.quantity, 0)} units
            </p>
          ))}
        </>
      )}
    </Panel>
  );
}
export function Coupons() {
  const scope = useCommerceScope(),
    coupons = useData<Coupon[]>(scope.storeId ? scope.path("/coupons") : null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRequestKey(),
    notify = useNotify();
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const iso = (value: FormDataEntryValue | null) =>
      value ? new Date(String(value)).toISOString() : null;
    const body = {
      code: String(form.get("code")),
      type: String(form.get("type")),
      value: Number(form.get("value")),
      minimumSpendCents: Number(form.get("minimumSpendCents")),
      maxUses: form.get("maxUses") ? Number(form.get("maxUses")) : null,
      perCustomerLimit: form.get("perCustomerLimit") ? Number(form.get("perCustomerLimit")) : null,
      startsAt: iso(form.get("startsAt")),
      expiresAt: iso(form.get("expiresAt")),
    };
    setBusy(true);
    setError("");
    try {
      await write(scope.path("/coupons"), body, "POST", key(body));
      setOpen(false);
      coupons.reload();
      notify("Coupon created.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(coupon: Coupon) {
    setBusy(true);
    setError("");
    try {
      await write(scope.path(`/coupons/${coupon.id}`), { active: !coupon.active }, "PATCH");
      coupons.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Coupons"
        description="Server verified discounts with fixed limits and per-unit refund amounts."
        actions={
          <>
            {scope.picker}
            {scope.manage && scope.storeId && (
              <Button onClick={() => setOpen(!open)}>Create coupon</Button>
            )}
          </>
        }
      />
      {error && <ErrorState error={error} />}
      {open && (
        <Panel title="New coupon">
          <form className="form-stack" onSubmit={create}>
            <div className="form-grid">
              <label>
                Code
                <input name="code" required minLength={2} maxLength={40} pattern="[A-Za-z0-9_-]+" />
              </label>
              <label>
                Discount type
                <Select name="type">
                  <option value="PERCENT">Percentage</option>
                  <option value="FIXED">Fixed amount in paise</option>
                </Select>
              </label>
              <label>
                Value
                <input name="value" type="number" required min={1} max={100000000} />
                <small>Percentage: 1–100. Fixed: amount in paise.</small>
              </label>
              <label>
                Minimum spend in paise
                <input name="minimumSpendCents" type="number" min={0} defaultValue={0} />
              </label>
              <label>
                Maximum uses
                <input name="maxUses" type="number" min={1} placeholder="Unlimited" />
              </label>
              <label>
                Uses per customer
                <input name="perCustomerLimit" type="number" min={1} placeholder="Unlimited" />
              </label>
              <label>
                Starts at
                <input name="startsAt" type="datetime-local" />
              </label>
              <label>
                Expires at
                <input name="expiresAt" type="datetime-local" />
              </label>
            </div>
            <Button type="submit" busy={busy}>
              Create coupon
            </Button>
          </form>
        </Panel>
      )}
      <Panel
        title="Promotions"
        subtitle="Usage is claimed at checkout; failed and abandoned orders retain their usage to prevent repeated claims."
      >
        {!scope.storeId ? (
          <Empty title="Choose a store" detail="Select a store to manage promotions." />
        ) : coupons.loading ? (
          <Loading />
        ) : coupons.error ? (
          <ErrorState error={coupons.error} retry={coupons.reload} />
        ) : coupons.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Minimum spend</th>
                  <th>Usage</th>
                  <th>Valid dates</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {coupons.data.map((coupon) => (
                  <tr key={coupon.id}>
                    <td>
                      <strong>{coupon.code}</strong>
                    </td>
                    <td>{coupon.type === "PERCENT" ? `${coupon.value}%` : money(coupon.value)}</td>
                    <td>{money(coupon.minimumSpendCents)}</td>
                    <td>
                      {coupon.uses} / {coupon.maxUses ?? "unlimited"}
                      <small>
                        {coupon.perCustomerLimit
                          ? `${coupon.perCustomerLimit} per customer`
                          : "No customer limit"}
                      </small>
                    </td>
                    <td>
                      {coupon.startsAt ? date(coupon.startsAt) : "Any start"}
                      <small>
                        {coupon.expiresAt ? `Until ${date(coupon.expiresAt)}` : "No expiry"}
                      </small>
                    </td>
                    <td>
                      <Status value={coupon.active ? "ACTIVE" : "INACTIVE"} />
                    </td>
                    <td>
                      {scope.manage && (
                        <Button busy={busy} variant="secondary" onClick={() => toggle(coupon)}>
                          {coupon.active ? "Disable" : "Enable"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No coupons yet" detail="Create a code for your next store promotion." />
        )}
      </Panel>
    </>
  );
}
interface ReconciliationRow {
  id: string;
  status: string;
  paymentMethod: string;
  totalCents: number;
  itemTotalCents: number;
  refundDueCents: number;
  refundedCents: number;
  recordedRefundsCents: number;
  createdAt: string;
  stripeSessionId: string | null;
  providerStatus: string | null;
  checkedAt: string | null;
  refundAttempts: { id: string; status: string; amountCents: number; checkedAt: string | null }[];
  discrepancies: string[];
}
export function Reconciliation() {
  const scope = useCommerceScope(),
    rows = useData<ReconciliationRow[]>(
      scope.storeId && scope.manage ? scope.path("/reconciliation") : null,
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const notify = useNotify();
  async function reconcile(row: ReconciliationRow, action: "PAYMENT" | "REFUND") {
    setBusy(row.id);
    setError("");
    try {
      await api(scope.path(`/reconciliation/${row.id}/reconcile`), {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      rows.reload();
      notify("Provider reconciliation completed.");
    } catch (e) {
      setError(message(e));
      rows.reload();
    } finally {
      setBusy("");
    }
  }
  if (!scope.manage)
    return <ErrorState error="An owner or manager must review payment reconciliation." />;
  return (
    <>
      <PageTitle
        title="Payment reconciliation"
        description="Compare order amounts, provider attempts and refund records."
        actions={
          <>
            {scope.picker}
            <Button variant="secondary" onClick={rows.reload}>
              Refresh records
            </Button>
          </>
        }
      />
      {error && <ErrorState error={error} />}
      <Panel
        title="Payment and refund checks"
        subtitle="Provider checks use the existing payment or refund attempt. Every check is recorded in activity."
      >
        {!scope.storeId ? (
          <Empty title="Choose a store" detail="Select an approved store to review its payments." />
        ) : rows.loading ? (
          <Loading />
        ) : rows.error ? (
          <ErrorState error={rows.error} retry={rows.reload} />
        ) : rows.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Amounts</th>
                  <th>Provider</th>
                  <th>Refunds</th>
                  <th>Checks</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{shortId(row.id)}</strong>
                      <small>
                        {date(row.createdAt)} · {row.paymentMethod}
                      </small>
                      <Status value={row.status} />
                    </td>
                    <td>
                      {money(row.totalCents)}
                      <small>Items: {money(row.itemTotalCents)}</small>
                    </td>
                    <td>
                      {row.providerStatus || "No provider attempt"}
                      <small>{row.checkedAt ? date(row.checkedAt) : "Not checked"}</small>
                    </td>
                    <td>
                      Due: {money(row.refundDueCents)}
                      <small>
                        Confirmed: {money(row.refundedCents)} · Ledger:{" "}
                        {money(row.recordedRefundsCents)}
                      </small>
                      {row.refundAttempts.map((attempt) => (
                        <small key={attempt.id}>
                          {attempt.status} · {money(attempt.amountCents)}
                        </small>
                      ))}
                    </td>
                    <td>
                      {row.discrepancies.length
                        ? row.discrepancies.map((issue) => (
                            <small key={issue}>{issue.toLowerCase().replaceAll("_", " ")}</small>
                          ))
                        : "Amounts consistent"}
                    </td>
                    <td>
                      {row.paymentMethod === "CARD" && (
                        <>
                          <Button
                            variant="secondary"
                            busy={busy === row.id}
                            disabled={!row.stripeSessionId && !row.providerStatus}
                            onClick={() => reconcile(row, "PAYMENT")}
                          >
                            Check payment
                          </Button>
                          {(row.refundDueCents > 0 ||
                            row.refundAttempts.some((attempt) =>
                              ["CREATING", "PENDING"].includes(attempt.status),
                            )) && (
                            <Button
                              variant="secondary"
                              busy={busy === row.id}
                              onClick={() => reconcile(row, "REFUND")}
                            >
                              Check refund
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No payment records"
            detail="Store orders and provider attempts appear here."
          />
        )}
      </Panel>
    </>
  );
}
