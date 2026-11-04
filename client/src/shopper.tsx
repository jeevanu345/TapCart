import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  CreditCard,
  LogOut,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store as StoreIcon,
  Trash2,
} from "lucide-react";
import {
  date,
  message,
  money,
  session,
  shortId,
  useData,
  write,
  type Order,
  type Product,
  type Session,
  type Store,
  type Unit,
} from "./api";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Logo,
  Modal,
  ProductArt,
  Status,
  ThemeToggle,
  useNotify,
} from "./ui";
import { homeFor, useAuth } from "./App";
import { OrderDetails } from "./orders";
interface NFCReadingEvent extends Event {
  message: { records: { recordType: string; data: DataView }[] };
}
interface NFCReader extends EventTarget {
  scan(options?: { signal: AbortSignal }): Promise<void>;
}
interface NFCConstructor {
  new (): NFCReader;
}
function unitIdFromInput(input: string) {
  const trimmed = input.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed))
    return trimmed;
  const url = new URL(trimmed, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error(
      "This link belongs to another store platform. Use a TapCart unit link from this site.",
    );
  const match = /^\/u\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (!match) throw new Error("Enter an NFC link ending in /u/ followed by the unit ID.");
  return match[1];
}
function ShopperHeader({ count = 0 }: { count?: number }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  return (
    <header className="shopper-header">
      <Link to="/customer">
        <Logo />
      </Link>
      <div className="actions">
        <ThemeToggle />
        {user ? (
          <>
            <span className="shopper-name">{user.name.split(" ")[0]}</span>
            {user.role !== "CUSTOMER" && (
              <Link className="text-button" to={homeFor(user)}>
                Workspace
                <ArrowUpRight size={14} />
              </Link>
            )}
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await write("/auth/logout", {});
                  await refresh();
                  navigate("/customer");
                  notify("You have been signed out.");
                } catch (e) {
                  notify(message(e));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <Link to="/login?returnTo=%2Fcustomer" className="button secondary">
            Sign in
            <ArrowRight size={15} />
          </Link>
        )}
        <a href="#basket" className="basket-icon" aria-label={`Your basket, ${count} units`}>
          <ShoppingBag size={21} />
          {count > 0 && <span>{count}</span>}
        </a>
      </div>
    </header>
  );
}
export function Shopper() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const products = useData<Product[]>("/products");
  const stores = useData<Store[]>("/stores");
  const cart = useData<Unit[]>(user?.role === "CUSTOMER" ? "/cart" : null);
  const history = useData<Order[]>(user?.role === "CUSTOMER" ? "/orders" : null);
  const [storeId, setStoreId] = useState("all");
  const [query, setQuery] = useState("");
  const [scanModal, setScanModal] = useState(false);
  const [preview, setPreview] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [allOrders, setAllOrders] = useState(false);
  const returnedOrderId = searchParams.get("order");
  useEffect(() => {
    if (!returnedOrderId || !history.data) return;
    const ownedOrder = history.data.find((order) => order.id === returnedOrderId);
    if (ownedOrder) setSelectedOrder(ownedOrder);
  }, [returnedOrderId, history.data]);
  const notify = useNotify();
  const list = (products.data || []).filter(
    (product) =>
      (storeId === "all" || product.storeId === storeId) &&
      `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  const items = cart.data || [];
  const total = items.reduce((sum, item) => sum + item.priceCents, 0);
  useEffect(() => {
    if (!user || user.role !== "CUSTOMER") return;
    const interval = setInterval(cart.reload, 30000);
    return () => clearInterval(interval);
  }, [user, cart.reload]);
  async function remove(unit: Unit) {
    if (!unit.reservationId) return;
    setBusy(true);
    setError("");
    try {
      await write(
        `/reservations/${unit.reservationId}`,
        { version: unit.version },
        "DELETE",
        crypto.randomUUID(),
      );
      cart.reload();
      notify("Item removed and released back to the shelf.");
    } catch (e) {
      setError(message(e));
      cart.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shopper-page">
      <ShopperHeader count={items.length} />
      <main className="shopper-main">
        <div className="shopper-welcome">
          <div>
            <h1>Tap the tag on anything you want.</h1>
            <p>It's held for you the moment you tap, while you keep shopping.</p>
          </div>
          <Button onClick={() => setScanModal(true)}>
            <Radio size={16} />
            Open a product tag
          </Button>
        </div>
        <div className="shopping-layout">
          <section className="shopper-catalog">
            <div className="catalog-heading">
              <h2>Browse</h2>
              <select
                value={storeId}
                aria-label="Browse store"
                onChange={(event) => setStoreId(event.target.value)}
              >
                <option value="all">All stores</option>
                {stores.data
                  ?.filter((store) => store.status === "APPROVED")
                  .map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search the catalog"
                placeholder="Search products"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {products.loading && !products.data ? (
              <Loading />
            ) : products.error ? (
              <ErrorState error={products.error} retry={products.reload} />
            ) : list.length ? (
              <div className="product-grid">
                {list.map((product) => (
                  <button
                    className="shop-product"
                    key={product.id}
                    onClick={() => setPreview(product)}
                  >
                    <div className="shop-product-art">
                      <ProductArt
                        category={product.category}
                        name={product.name}
                        imageUrl={product.imageUrl}
                      />
                      <span className="shop-product-tap">
                        <ArrowUpRight size={17} />
                      </span>
                      {product.available === 0 && <span className="sold-label">Out of stock</span>}
                    </div>
                    <span className="shop-product-category">{product.category}</span>
                    <span className="shop-product-bottom">
                      <strong>{product.name}</strong>
                      <strong>{money(product.priceCents)}</strong>
                    </span>
                    <span className="shop-product-detail">
                      {product.available > 0 ? `${product.available} in store` : "Out of stock"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="No products found" detail="Try another store or search." />
            )}
          </section>
          <aside className="basket-panel" id="basket">
            <div className="basket-heading">
              <ShoppingBag size={20} />
              <h2>Your basket</h2>
              <span>{items.length}</span>
            </div>
            {user?.role !== "CUSTOMER" ? (
              <Empty
                title="Sign in to hold items"
                detail={
                  user
                    ? "Use a shopper account to reserve items and checkout."
                    : "Your basket follows you across your visit."
                }
              >
                <Link to="/login?returnTo=%2Fcustomer" className="button secondary">
                  Sign in
                  <ArrowRight size={15} />
                </Link>
              </Empty>
            ) : cart.loading && !cart.data ? (
              <Loading />
            ) : cart.error ? (
              <ErrorState error={cart.error} retry={cart.reload} />
            ) : items.length ? (
              <>
                <div className="basket-items">
                  {items.map((unit) => (
                    <div className="basket-item" key={unit.id}>
                      <ProductArt
                        category={unit.category}
                        name={unit.name}
                        imageUrl={unit.imageUrl}
                        small
                      />
                      <div>
                        <strong>{unit.name}</strong>
                        <small>{unit.staffCode} · 1 unit</small>
                        <LeaseTimer until={unit.reservedUntil ?? null} onExpire={cart.reload} />
                      </div>
                      <div>
                        <strong>{money(unit.priceCents)}</strong>
                        <button
                          className="icon-button"
                          disabled={
                            busy ||
                            !!(
                              unit.checkoutProtectedUntil &&
                              new Date(unit.checkoutProtectedUntil).getTime() > Date.now()
                            )
                          }
                          aria-label={`Remove ${unit.name}`}
                          onClick={() => remove(unit)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="basket-total">
                  <span>Subtotal</span>
                  <strong>{money(total)}</strong>
                </div>
                <p className="basket-note">Held only for you until the timer ends.</p>
                {error && <ErrorState error={error} />}
                <Button className="full-width" onClick={() => setCheckout(true)}>
                  Ready to checkout
                  <ArrowRight size={16} />
                </Button>
                <Button variant="ghost" className="full-width" onClick={() => setScanModal(true)}>
                  <Radio size={15} />
                  Add another tagged item
                </Button>
              </>
            ) : (
              <Empty
                title="Your basket is empty"
                detail="Tap a product's tag to hold the exact item in your hand."
              >
                <Button variant="secondary" onClick={() => setScanModal(true)}>
                  <Radio size={16} />
                  Open a tag
                </Button>
              </Empty>
            )}
          </aside>
        </div>
        {user?.role === "CUSTOMER" && (
          <section className="shopper-orders">
            <div className="catalog-heading">
              <h2>Your orders</h2>
              <Button variant="ghost" onClick={history.reload} aria-label="Refresh your orders">
                <RefreshCw size={16} />
              </Button>
            </div>
            {history.error ? (
              <ErrorState error={history.error} retry={history.reload} />
            ) : history.data?.length ? (
              <div className="shopper-order-list">
                {history.data.slice(0, allOrders ? undefined : 5).map((order) => (
                  <button key={order.id} onClick={() => setSelectedOrder(order)}>
                    <span>
                      <strong>{shortId(order.id)}</strong>
                      <small>
                        {order.storeName} · {date(order.createdAt)}
                      </small>
                    </span>
                    <Status value={order.status} />
                    <strong>{money(order.totalCents)}</strong>
                    <ArrowRight size={17} />
                  </button>
                ))}
                {history.data.length > 5 && (
                  <Button variant="ghost" onClick={() => setAllOrders(!allOrders)}>
                    {allOrders ? "Show fewer" : `Show all ${history.data.length} orders`}
                  </Button>
                )}
              </div>
            ) : (
              <p className="muted">Your orders will appear here.</p>
            )}
          </section>
        )}
      </main>
      {scanModal && <ScanInput onClose={() => setScanModal(false)} />}{" "}
      {preview && <ProductPreview product={preview} onClose={() => setPreview(null)} />}{" "}
      {checkout && (
        <Checkout
          items={items}
          onClose={() => setCheckout(false)}
          onComplete={(order) => {
            setCheckout(false);
            setSelectedOrder(order);
            cart.reload();
            history.reload();
          }}
        />
      )}{" "}
      {selectedOrder && (
        <Modal
          title={`Order ${shortId(selectedOrder.id)}`}
          description={selectedOrder.storeName}
          onClose={() => {
            setSelectedOrder(null);
            setSearchParams({});
          }}
        >
          <LiveOrder id={selectedOrder.id} />
        </Modal>
      )}
    </div>
  );
}
function LeaseTimer({ until, onExpire }: { until: string | null; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const expired = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor(((until ? new Date(until).getTime() : now) - now) / 1000));
  useEffect(() => {
    if (seconds === 0 && !expired.current) {
      expired.current = true;
      onExpire?.();
    }
  }, [seconds, onExpire]);
  return (
    <span className={`lease ${seconds < 60 ? "urgent" : ""}`}>
      <Clock3 size={11} />
      {seconds > 0
        ? `Held for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
        : "Reservation expired"}
    </span>
  );
}
function ScanInput({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const Reader = (window as unknown as { NDEFReader?: NFCConstructor }).NDEFReader;
  useEffect(() => () => abort.current?.abort(), []);
  function open(value: string) {
    try {
      const id = unitIdFromInput(value);
      onClose();
      navigate(`/u/${id}`);
    } catch (e) {
      setError(message(e));
    }
  }
  async function scan() {
    if (!Reader) return;
    setError("");
    setReading(true);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const reader = new Reader();
      await reader.scan({ signal: controller.signal });
      reader.addEventListener(
        "reading",
        (event) => {
          const record = (event as NFCReadingEvent).message.records.find(
            (value) => value.recordType === "url" || value.recordType === "text",
          );
          if (!record) {
            setError("This tag has no supported product link.");
            return;
          }
          open(new TextDecoder().decode(record.data));
          controller.abort();
          setReading(false);
        },
        { once: true },
      );
      reader.addEventListener(
        "readingerror",
        () => {
          setError("We couldn’t read that tag. Hold still and try again, or paste its link.");
          controller.abort();
          setReading(false);
        },
        { once: true },
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
      setReading(false);
    }
  }
  return (
    <Modal
      title="Open a product tag"
      description="Tap the tag with your phone, or paste its link below."
      onClose={onClose}
    >
      <div className="scan-target" data-reading={reading}>
        <i aria-hidden="true" />
        <Radio size={32} strokeWidth={1.4} />
        <span>{reading ? "Hold your phone near the tag…" : "Ready when you are"}</span>
      </div>
      {Reader ? (
        <Button busy={reading} className="full-width" onClick={scan}>
          Start NFC reader
        </Button>
      ) : (
        <p className="form-hint">
          Your browser doesn’t offer in-page NFC reading. Most NFC phones can open a tag’s HTTPS
          link directly without this reader.
        </p>
      )}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          open(input);
        }}
      >
        <label>
          Product NFC link or unit ID
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            required
            placeholder={`${window.location.origin}/u/…`}
          />
        </label>
        {error && <ErrorState error={error} />}
        <Button variant="secondary" type="submit" disabled={!input.trim()}>
          Open product
          <ArrowRight size={16} />
        </Button>
      </form>
    </Modal>
  );
}
function ProductPreview({ product, onClose }: { product: Product; onClose: () => void }) {
  const units = useData<Unit[]>(`/units?productId=${product.id}`);
  return (
    <Modal title={product.name} description={product.category} onClose={onClose}>
      <div className="product-preview-art">
        <ProductArt category={product.category} name={product.name} imageUrl={product.imageUrl} />
      </div>
      <div className="product-preview-price">
        <strong>{money(product.priceCents)}</strong>
        <Status value={product.available ? "IN_STOCK" : "OUT_OF_STOCK"} />
      </div>
      <p className="product-description">{product.description}</p>
      <div className="inline-info">
        <Radio size={19} />
        In store? Tap the NFC tag on the exact item you’re holding to reserve it.
      </div>
      {units.data?.some((unit) => unit.status === "AVAILABLE") ? (
        <div className="preview-units">
          <h3>Available units</h3>
          {units.data
            .filter((unit) => unit.status === "AVAILABLE")
            .slice(0, 4)
            .map((unit) => (
              <Link key={unit.id} className="preview-unit" to={`/u/${unit.id}`}>
                <span>
                  <Radio size={16} />
                  {unit.staffCode}
                </span>
                <span>
                  Open unit
                  <ArrowUpRight size={15} />
                </span>
              </Link>
            ))}
        </div>
      ) : units.error ? (
        <p className="form-hint">Use the physical product’s tag link to open its unit.</p>
      ) : null}
    </Modal>
  );
}
export function Scan() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const unit = useData<Unit>(`/units/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const notify = useNotify();
  async function reserve() {
    if (!unit.data) return;
    setBusy(true);
    setError("");
    try {
      await write<Unit>(
        "/reservations",
        { unitId: unit.data.id, version: unit.data.version },
        "POST",
        key.current,
      );
      notify(`${unit.data.name} is held in your basket.`);
      navigate("/customer#basket");
    } catch (e) {
      setError(message(e));
      unit.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shopper-page">
      <ShopperHeader />
      <main className="scan-page">
        <Link className="text-button" to="/customer">
          <ArrowLeft size={16} />
          Back to browsing
        </Link>
        {unit.loading ? (
          <Loading />
        ) : unit.error || !unit.data ? (
          <ErrorState
            error={unit.error || "This product tag is unavailable."}
            retry={unit.reload}
          />
        ) : (
          <div className="scan-product">
            <div className="scan-product-art">
              <ProductArt
                category={unit.data.category}
                name={unit.data.name}
                imageUrl={unit.data.imageUrl}
              />
            </div>
            <div className="scan-product-info">
              <small className="scan-category">{unit.data.category}</small>
              <h1>{unit.data.name}</h1>
              <strong className="scan-price">{money(unit.data.priceCents)}</strong>
              <div className="scan-unit-meta">
                <Status value={unit.data.status} />
                <span>{unit.data.staffCode}</span>
              </div>
              <p>
                This link belongs to one physical item. Reserve it to hold this exact unit while you
                shop.
              </p>
              {error && <ErrorState error={error} />}{" "}
              {!user ? (
                <Link
                  to={`/login?returnTo=${encodeURIComponent(`/u/${id}`)}`}
                  className="button primary"
                >
                  Sign in to reserve
                  <ArrowRight size={17} />
                </Link>
              ) : user.role !== "CUSTOMER" ? (
                <div className="inline-info">
                  <ShieldCheck size={18} />
                  Use a shopper account to reserve physical items. You’re currently signed in as{" "}
                  {user.role.toLowerCase()}.
                </div>
              ) : unit.data.status === "AVAILABLE" ? (
                <Button busy={busy} onClick={reserve}>
                  <ShoppingBag size={18} />
                  Reserve this item
                  <ArrowRight size={17} />
                </Button>
              ) : (
                <>
                  <div className="inline-info">
                    <Clock3 size={18} />
                    {unit.data.status === "SOLD"
                      ? "This exact unit has been sold."
                      : "This exact unit is currently held in a basket. Check your basket or try another tagged item."}
                  </div>
                  <Link to="/customer#basket" className="button secondary">
                    View your basket
                    <ArrowRight size={16} />
                  </Link>
                </>
              )}
              <p className="scan-footnote">
                <ShieldCheck size={14} />
                Availability is confirmed when your reservation succeeds.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
function Checkout({
  items,
  onClose,
  onComplete,
}: {
  items: Unit[];
  onClose: () => void;
  onComplete: (order: Order) => void;
}) {
  const [method, setMethod] = useState<"DESK" | "DEVELOPMENT" | "CARD">("DESK");
  const [capabilities, setCapabilities] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    session()
      .then((value) => setCapabilities(value))
      .catch((e: unknown) => setError(message(e)));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const order = await write<Order>(
        "/orders",
        {
          items: items.map((unit) => ({
            unitId: unit.id,
            reservationId: unit.reservationId,
            version: unit.version,
          })),
          method,
        },
        "POST",
        key.current,
      );
      onComplete(order);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Checkout"
      description="Review your items and choose how to pay."
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <div className="checkout-lines">
          {items.map((unit) => (
            <div key={unit.id}>
              <span>
                {unit.name}
                <small>{unit.staffCode} · 1 physical unit</small>
              </span>
              <strong>{money(unit.priceCents)}</strong>
            </div>
          ))}
        </div>
        <fieldset className="payment-options">
          <legend>Payment method</legend>
          <label className={method === "DESK" ? "selected" : ""}>
            <input
              type="radio"
              name="method"
              value="DESK"
              checked={method === "DESK"}
              onChange={() => setMethod("DESK")}
            />
            <StoreIcon size={18} />
            <span>
              <strong>Pay at the desk</strong>
              <small>Your store team confirms payment after you pay.</small>
            </span>
          </label>
          {capabilities?.cardPayments && items.some((item) => item.priceCents > 0) && (
            <label className={method === "CARD" ? "selected" : ""}>
              <input
                type="radio"
                name="method"
                value="CARD"
                checked={method === "CARD"}
                onChange={() => setMethod("CARD")}
              />
              <CreditCard size={18} />
              <span>
                <strong>Pay securely by card</strong>
                <small>Continue to our payment provider after placing the order.</small>
              </span>
            </label>
          )}
          {capabilities?.developmentPayments && (
            <label className={method === "DEVELOPMENT" ? "selected" : ""}>
              <input
                type="radio"
                name="method"
                value="DEVELOPMENT"
                checked={method === "DEVELOPMENT"}
                onChange={() => setMethod("DEVELOPMENT")}
              />
              <CreditCard size={18} />
              <span>
                <strong>Development simulator</strong>
                <small>Test only. No money is charged.</small>
              </span>
            </label>
          )}
        </fieldset>
        <div className="order-total">
          <span>Total payable</span>
          <strong>{money(items.reduce((sum, unit) => sum + unit.priceCents, 0))}</strong>
        </div>
        <p className="form-hint">
          Availability and prices are checked again when you place this order. Your items stay
          protected while payment is pending.
        </p>
        {error && <ErrorState error={error} />}
        <Button type="submit" busy={busy} disabled={!items.length}>
          Place order
          <ArrowRight size={16} />
        </Button>
      </form>
    </Modal>
  );
}
function LiveOrder({ id }: { id: string }) {
  const order = useData<Order>(`/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notify = useNotify();
  useEffect(() => {
    if (order.data?.status !== "PAYMENT_PENDING" && order.data?.status !== "PAID") return;
    const interval = setInterval(order.reload, 5000);
    return () => clearInterval(interval);
  }, [order.data?.status, order.reload]);
  async function simulate(outcome: "SUCCEEDED" | "FAILED") {
    setBusy(true);
    setError("");
    try {
      await write(`/orders/${id}/development-payment`, { outcome }, "POST", crypto.randomUUID());
      order.reload();
      notify(
        outcome === "SUCCEEDED"
          ? "Development payment completed. No real money was charged."
          : "Payment failure simulated. No charge was made.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return order.loading && !order.data ? (
    <Loading />
  ) : order.error || !order.data ? (
    <ErrorState error={order.error || "Order unavailable"} />
  ) : (
    <>
      <OrderDetails order={order.data} onChange={order.reload} customer />
      {error && <ErrorState error={error} />}{" "}
      {order.data.paymentMethod === "CARD" && order.data.status === "PAYMENT_PENDING" && (
        <div className="dev-payment">
          <p>Continue to the secure payment provider to complete your order.</p>
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await write<{ url: string | null }>(
                  `/orders/${id}/card-payment`,
                  {},
                  "POST",
                  crypto.randomUUID(),
                );
                if (!result.url) {
                  order.reload();
                  setBusy(false);
                  return;
                }
                const destination = new URL(result.url);
                if (
                  destination.protocol !== "https:" ||
                  destination.hostname !== "checkout.stripe.com"
                )
                  throw new Error(
                    "The payment provider returned an unexpected link. Please contact the store.",
                  );
                window.location.assign(destination.href);
              } catch (e) {
                setError(message(e));
                setBusy(false);
              }
            }}
          >
            Continue to secure payment
            <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
      {order.data.paymentMethod === "DEVELOPMENT" && order.data.status === "PAYMENT_PENDING" && (
        <div className="dev-payment">
          <strong>Development simulator. No real charge.</strong>
          <p>Choose a result to exercise the payment flow.</p>
          <div className="actions">
            <Button busy={busy} onClick={() => simulate("SUCCEEDED")}>
              Simulate success
            </Button>
            <Button variant="secondary" busy={busy} onClick={() => simulate("FAILED")}>
              Simulate failure
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
