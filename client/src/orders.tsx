import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Download,
  ReceiptText,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  api,
  date,
  dateTime,
  downloadCSV,
  message,
  money,
  shortId,
  useData,
  write,
  type Order,
  type OrderItem,
  type Unit,
} from "./api";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Logo,
  Modal,
  PageTitle,
  Panel,
  Status,
  useNotify,
} from "./ui";
import { useAuth } from "./App";
export function Desk() {
  const orders = useData<Order[]>("/orders");
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [found, setFound] = useState<Unit | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const notify = useNotify();
  useEffect(() => {
    const interval = setInterval(orders.reload, 5000);
    return () => clearInterval(interval);
  }, [orders.reload]);
  const queue = (orders.data || []).filter((order) => order.status === "PAYMENT_PENDING");
  const refunds = (orders.data || []).filter((order) => order.status === "REFUND_PENDING");
  const open = (orders.data || []).find((order) => order.id === selected);
  async function settle(order: Order) {
    setBusy(order.id);
    setError("");
    try {
      await write(`/orders/${order.id}/confirm-payment`, {}, "POST", crypto.randomUUID());
      notify(`${shortId(order.id)} settled. Payment recorded.`);
      orders.reload();
    } catch (e) {
      setError(message(e));
      orders.reload();
    } finally {
      setBusy("");
    }
  }
  async function find(event: FormEvent) {
    event.preventDefault();
    setLookupError("");
    setFound(null);
    const value = lookup.trim();
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(value)?.[0];
    try {
      if (uuid) setFound(await api<Unit>(`/units/${uuid}`));
      else {
        const rows = await api<Unit[]>("/units");
        const match = rows.find((row) => row.staffCode.toLowerCase() === value.toLowerCase());
        if (!match) throw new Error("No unit has that link or staff code.");
        setFound(match);
      }
    } catch (e) {
      setLookupError(message(e));
    }
  }
  return (
    <>
      <PageTitle
        title="Desk"
        description="Orders waiting on payment. This queue refreshes by itself."
      />
      {error && <ErrorState error={error} />}
      <div className="desk-grid">
        <Panel
          title={`${queue.length} waiting`}
          subtitle={`${money(queue.reduce((sum, order) => sum + order.totalCents, 0))} to collect`}
        >
          {orders.loading && !orders.data ? (
            <Loading />
          ) : orders.error && !orders.data ? (
            <ErrorState error={orders.error} retry={orders.reload} />
          ) : queue.length ? (
            <ul className="desk-queue">
              {queue.map((order) => (
                <li key={order.id}>
                  <button className="desk-order" onClick={() => setSelected(order.id)}>
                    <strong>{order.customerName}</strong>
                    <small>
                      {shortId(order.id)} · {order.items.length} unit
                      {order.items.length === 1 ? "" : "s"} · {dateTime(order.createdAt)}
                    </small>
                  </button>
                  <strong className="desk-amount">{money(order.totalCents)}</strong>
                  {order.paymentMethod === "DESK" ? (
                    <Button busy={busy === order.id} onClick={() => settle(order)}>
                      <Check size={15} />
                      Payment received
                    </Button>
                  ) : (
                    <span className="muted">Paying by card</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="The desk is clear" detail="New orders appear here within seconds." />
          )}
        </Panel>
        <div className="desk-side">
          <Panel title="Look up a unit" subtitle="Paste a tag link or type a staff code.">
            <form className="chat-form" onSubmit={find}>
              <input
                aria-label="Tag link or staff code"
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!lookup.trim()}>
                Find
              </Button>
            </form>
            {lookupError && <ErrorState error={lookupError} />}
            {found && (
              <div className="unit-found">
                <strong>{found.name}</strong>
                <code>{found.staffCode}</code>
                <Status value={found.status} />
                <span>{money(found.priceCents)}</span>
              </div>
            )}
          </Panel>
          {refunds.length > 0 && (
            <Panel title={`${refunds.length} refunds to settle`}>
              <ul className="desk-queue compact">
                {refunds.map((order) => (
                  <li key={order.id}>
                    <button className="desk-order" onClick={() => setSelected(order.id)}>
                      <strong>{order.customerName}</strong>
                      <small>{shortId(order.id)}</small>
                    </button>
                    <strong className="desk-amount">{money(order.refundDueCents)}</strong>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
      {open && (
        <Modal
          title={`Order ${shortId(open.id)}`}
          description={`${open.customerName} · ${date(open.createdAt)}`}
          onClose={() => setSelected(null)}
        >
          <OrderDetails order={open} onChange={orders.reload} />
        </Modal>
      )}
    </>
  );
}
const STAGES = ["PAYMENT_PENDING", "PAID", "COMPLETED"];
/** Payment state machine from the protocol, shown as it actually moved. */
function OrderTimeline({ order }: { order: Order }) {
  const branch = ["PAYMENT_FAILED", "REFUND_PENDING", "REFUNDED"].includes(order.status);
  const reached = branch
    ? order.completedAt
      ? 2
      : order.paidAt
        ? 1
        : 0
    : STAGES.indexOf(order.status);
  const stages = [
    { label: "Ordered", time: order.createdAt },
    { label: "Paid", time: order.paidAt },
    { label: "Completed", time: order.completedAt },
  ];
  return (
    <ol className="order-timeline" aria-label="Order progress">
      {stages.map((stage, index) => (
        <li key={stage.label} data-on={index <= reached}>
          <span aria-hidden="true" />
          <strong>{stage.label}</strong>
          <small>{stage.time && index <= reached ? dateTime(stage.time) : "—"}</small>
        </li>
      ))}
      {branch && (
        <li data-on="true" data-branch="true">
          <span aria-hidden="true" />
          <strong>
            {order.status === "PAYMENT_FAILED"
              ? "Failed"
              : order.status === "REFUNDED"
                ? "Refunded"
                : "Refund due"}
          </strong>
          <small>{order.failureReason ? "See note" : "—"}</small>
        </li>
      )}
    </ol>
  );
}
export function Orders() {
  const orders = useData<Order[]>("/orders");
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(params.get("status") || "all");
  const selected = (orders.data || []).find((order) => order.id === params.get("order"));
  const pending = (orders.data || []).filter((order) => order.status === "PAYMENT_PENDING");
  const completed = (orders.data || []).filter((order) => order.status === "COMPLETED");
  const list = (orders.data || []).filter(
    (order) =>
      `${order.id} ${shortId(order.id)} ${order.customerName}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "all" || order.status === status),
  );
  return (
    <>
      <PageTitle
        title="Orders"
        description="Every checkout, from reservation to receipt."
        actions={
          <Button
            variant="secondary"
            disabled={!list.length}
            onClick={() =>
              downloadCSV("tapcart-orders.csv", [
                ["Order", "Customer", "Status", "Payment method", "Total INR", "Created"],
                ...list.map((order) => [
                  order.id,
                  order.customerName,
                  order.status,
                  order.paymentMethod,
                  order.totalCents / 100,
                  order.createdAt,
                ]),
              ])
            }
          >
            <Download size={16} />
            Export
          </Button>
        }
      />
      <div className="metric-strip three">
        <div>
          <span>Total orders</span>
          <strong>{orders.data?.length || 0}</strong>
        </div>
        <div>
          <span>Awaiting payment</span>
          <strong>{pending.length}</strong>
        </div>
        <div>
          <span>Completed revenue</span>
          <strong>{money(completed.reduce((sum, order) => sum + order.totalCents, 0))}</strong>
        </div>
      </div>
      {pending.length > 0 && (
        <Link to="/store/desk" className="next-action">
          <strong>
            {pending.length} {pending.length === 1 ? "order is" : "orders are"} waiting for payment
          </strong>
          <span>Open the desk</span>
          <ArrowRight size={16} />
        </Link>
      )}
      <Panel>
        <div className="inventory-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search orders"
              placeholder="Search order or customer…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="Filter order status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All orders</option>
            <option value="PAYMENT_PENDING">Awaiting payment</option>
            <option value="COMPLETED">Completed</option>
            <option value="PAYMENT_FAILED">Payment failed</option>
            <option value="REFUND_PENDING">Refund pending</option>
            <option value="REFUNDED">Refunded</option>
          </select>
        </div>
        {orders.loading && !orders.data ? (
          <Loading />
        ) : orders.error ? (
          <ErrorState error={orders.error} retry={orders.reload} />
        ) : list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="number">Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">View order</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <button className="table-link" onClick={() => setParams({ order: order.id })}>
                        {shortId(order.id)}
                      </button>
                      <small>{date(order.createdAt)}</small>
                    </td>
                    <td>{order.customerName}</td>
                    <td>{order.items.length}</td>
                    <td className="number">{money(order.totalCents)}</td>
                    <td>
                      {order.paymentMethod === "DESK"
                        ? "Pay at desk"
                        : order.paymentMethod === "CARD"
                          ? "Card"
                          : "Development"}
                    </td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${shortId(order.id)}`}
                        onClick={() => setParams({ order: order.id })}
                      >
                        <ArrowRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={query || status !== "all" ? "No matching orders" : "No orders yet"}
            detail={
              query || status !== "all"
                ? "Try another search or status."
                : "Shopper orders will appear here."
            }
          />
        )}
        <div className="table-footer">
          <span>{list.length} orders</span>
        </div>
      </Panel>
      {selected && (
        <Modal
          title={`Order ${shortId(selected.id)}`}
          description={`${selected.customerName} · ${date(selected.createdAt)}`}
          onClose={() => setParams({})}
        >
          <OrderDetails order={selected} onChange={orders.reload} />
        </Modal>
      )}
    </>
  );
}
export function OrderDetails({
  order,
  onChange,
  customer = false,
}: {
  order: Order;
  onChange: () => void;
  customer?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnItem, setReturnItem] = useState<OrderItem | null>(null);
  const notify = useNotify();
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await write(`/orders/${order.id}/confirm-payment`, {}, "POST", crypto.randomUUID());
      notify("Payment confirmed. The order is complete.");
      onChange();
    } catch (e) {
      setError(message(e));
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function returnUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returnItem) return;
    const reason = String(new FormData(event.currentTarget).get("reason"));
    setBusy(true);
    setError("");
    try {
      const unit = await api<Unit>(`/units/${returnItem.unitId}`);
      await write(
        `/units/${unit.id}/return`,
        { orderId: order.id, version: unit.version, reason },
        "POST",
        crypto.randomUUID(),
      );
      notify("Unit returned to inventory.");
      setReturnItem(null);
      onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="order-details">
      <div className="detail-status">
        <Status value={order.status} />
        <span>
          {order.paymentMethod === "DESK"
            ? "Pay at desk"
            : order.paymentMethod === "CARD"
              ? "Card payment"
              : "Development payment"}
        </span>
      </div>
      <OrderTimeline order={order} />
      {order.status === "PAYMENT_PENDING" && (
        <div className="inline-info">
          <Clock3 size={17} />
          {customer
            ? "Your order is waiting for payment. Please visit the store desk."
            : "Confirm only after you have received the payment at your desk."}
        </div>
      )}
      {order.status === "PAYMENT_FAILED" && (
        <ErrorState error="Payment did not complete. Your order has not been marked as sold." />
      )}
      {order.status === "REFUND_PENDING" && (
        <div className="inline-info">
          <RotateCcw size={17} />
          Payment requires review. A staff member will reconcile the refund.
        </div>
      )}
      <div className="order-lines">
        {order.items.map((item) => (
          <div className="order-line" key={item.unitId}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.sku} · 1 unit {item.returnedAt && "· Returned"}
              </small>
            </span>
            <strong>{money(item.priceCents)}</strong>
            {!customer &&
              ["COMPLETED", "REFUND_PENDING"].includes(order.status) &&
              !item.returnedAt && (
                <button
                  className="icon-button"
                  title="Return unit"
                  aria-label={`Return ${item.name}`}
                  onClick={() => setReturnItem(item)}
                >
                  <RotateCcw size={16} />
                </button>
              )}
          </div>
        ))}
      </div>
      <div className="order-total">
        <span>Total</span>
        <strong>{money(order.totalCents)}</strong>
      </div>
      {order.refundDueCents > 0 && (
        <p className="inline-info">
          Refund due: {money(order.refundDueCents)}
          {order.paymentMethod === "CARD" ? " · returned through the card provider" : ""}
        </p>
      )}
      {order.refundedCents > 0 && (
        <p className="form-hint">Already refunded: {money(order.refundedCents)}</p>
      )}
      {error && <ErrorState error={error} />}
      <div className="modal-actions">
        <Link to={`/receipt/${order.id}`} className="button secondary">
          <ReceiptText size={16} />
          View receipt
        </Link>
        {!customer && order.status === "PAYMENT_PENDING" && order.paymentMethod === "DESK" && (
          <Button busy={busy} onClick={confirm}>
            <Check size={16} />
            Confirm payment received
          </Button>
        )}
        {!customer && order.status === "REFUND_PENDING" && (
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await write<{ status?: string }>(
                  `/orders/${order.id}/${order.paymentMethod === "CARD" ? "card-refund" : "confirm-refund"}`,
                  {},
                  "POST",
                  crypto.randomUUID(),
                );
                notify(
                  order.paymentMethod === "CARD"
                    ? `Card refund: ${result.status?.toLowerCase() || "review required"}.`
                    : "Refund recorded.",
                );
                onChange();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {order.paymentMethod === "CARD" ? "Refund to card" : "Record completed refund"}
          </Button>
        )}
      </div>
      {returnItem && (
        <form onSubmit={returnUnit} className="return-form">
          <h3>Return {returnItem.name}</h3>
          <label>
            Reason for return
            <input
              name="reason"
              required
              minLength={5}
              maxLength={500}
              placeholder="e.g. Customer returned unopened item"
            />
          </label>
          <div className="actions">
            <Button variant="secondary" type="button" onClick={() => setReturnItem(null)}>
              Cancel
            </Button>
            <Button busy={busy} type="submit">
              Return to inventory
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
export function Receipt() {
  const { id } = useParams();
  const { user } = useAuth();
  const order = useData<Order>(`/orders/${id}`);
  const staff = user?.role === "STORE";
  return (
    <div className="receipt-page">
      <header>
        <Link to="/">
          <Logo />
        </Link>
        <Link
          to={staff ? "/store/orders" : user?.role === "ADMIN" ? "/admin" : "/customer"}
          className="text-button"
        >
          <ArrowLeft size={16} />
          Back to {staff ? "orders" : user?.role === "ADMIN" ? "stores" : "shopping"}
        </Link>
      </header>
      {order.loading ? (
        <Loading />
      ) : order.error || !order.data ? (
        <ErrorState error={order.error || "Order unavailable"} retry={order.reload} />
      ) : (
        <Panel className="receipt">
          <div className="receipt-heading">
            <h1>{order.data.storeName}</h1>
            <p>
              {order.data.status === "COMPLETED"
                ? "Thanks for shopping with us."
                : "Check the status below before leaving the store."}
            </p>
          </div>
          <div className="receipt-meta">
            <span>
              Order <strong>{shortId(order.data.id)}</strong>
            </span>
            <span>{date(order.data.createdAt)}</span>
          </div>
          <OrderDetails
            order={order.data}
            onChange={order.reload}
            customer={user?.role === "CUSTOMER"}
          />
          <a
            className="button primary"
            href={`/api/orders/${id}/invoice?format=html`}
            target="_blank"
            rel="noreferrer"
          >
            <Download size={16} />
            Open printable invoice
          </a>
        </Panel>
      )}
    </div>
  );
}
