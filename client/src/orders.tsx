import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Package,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
} from "lucide-react";
import {
  api,
  date,
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
export function Orders() {
  const orders = useData<Order[]>("/orders");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [params, setParams] = useSearchParams();
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
        eyebrow="EVERY CHECKOUT, ACCOUNTED FOR"
        title="The little moments add up."
        description="Follow every order, from a shopper’s basket to a happy goodbye."
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
            Export orders
          </Button>
        }
      />
      <div className="summary-strip">
        <div>
          <ShoppingBag size={20} />
          <strong>{orders.data?.length || 0}</strong>
          <span>Total orders</span>
        </div>
        <div>
          <Clock3 size={20} />
          <strong>{pending.length}</strong>
          <span>Awaiting payment</span>
        </div>
        <div>
          <CheckCircle2 size={20} />
          <strong>{money(completed.reduce((sum, order) => sum + order.totalCents, 0))}</strong>
          <span>Completed revenue</span>
        </div>
      </div>
      {pending.length > 0 && (
        <div className="attention-banner">
          <Clock3 size={19} />
          <div>
            <strong>
              {pending.length} {pending.length === 1 ? "order is" : "orders are"} waiting for
              payment.
            </strong>
            <span>Review desk payments when your shoppers are ready.</span>
          </div>
          <Button variant="secondary" onClick={() => setStatus("PAYMENT_PENDING")}>
            Review payments
            <ArrowRight size={15} />
          </Button>
        </div>
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
        {orders.loading ? (
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
                  <th>Total</th>
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
                    <td>
                      <div className="customer-cell">
                        <span className="avatar small">
                          {order.customerName.slice(0, 2).toUpperCase()}
                        </span>
                        {order.customerName}
                      </div>
                    </td>
                    <td>{order.items.length} units</td>
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
            title={
              query || status !== "all" ? "No matching orders" : "Ready for the first of many."
            }
            detail={
              query || status !== "all"
                ? "Try another search or status."
                : "Your shoppers’ orders will appear here."
            }
          />
        )}
        <div className="table-footer">
          <span>{list.length} orders</span>
          <span>Totals calculated by your store</span>
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
            <span className="line-icon">
              <Package size={19} />
            </span>
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
  return (
    <div className="receipt-page">
      <header>
        <Link to="/">
          <Logo />
        </Link>
        <Link
          to={user?.role === "CUSTOMER" ? "/customer" : "/store/orders"}
          className="text-button"
        >
          <ArrowLeft size={16} />
          Back to {user?.role === "CUSTOMER" ? "shopping" : "orders"}
        </Link>
      </header>
      {order.loading ? (
        <Loading />
      ) : order.error || !order.data ? (
        <ErrorState error={order.error || "Order unavailable"} retry={order.reload} />
      ) : (
        <Panel className="receipt">
          <div className="receipt-heading">
            <span className="receipt-symbol">
              <ShoppingBag size={29} strokeWidth={1.4} />
            </span>
            <span className="eyebrow">{order.data.storeName}</span>
            <h1>
              {order.data.status === "COMPLETED"
                ? "A little thank you."
                : "Your order, at a glance."}
            </h1>
            <p>
              {order.data.status === "COMPLETED"
                ? "For shopping with us. See you around the neighborhood."
                : "Check the status below before leaving the store."}
            </p>
            <Status value={order.data.status} />
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
          <div className="receipt-footer">
            <Logo compact />
            <p>
              Good things come full circle.
              <br />
              Thanks for being part of ours.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
