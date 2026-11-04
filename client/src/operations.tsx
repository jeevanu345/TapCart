import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Clock3,
  Download,
  Package,
  Plus,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  date,
  downloadCSV,
  message,
  money,
  shortId,
  useData,
  write,
  type Analytics,
  type Customer,
  type Dashboard,
  type Store,
  type User,
} from "./api";
import {
  ArrowLink,
  Button,
  Empty,
  ErrorState,
  Loading,
  PageTitle,
  Panel,
  ProductArt,
  Status,
  useNotify,
} from "./ui";
import { useAuth } from "./App";
const RevenueChart = lazy(() => import("./Chart"));
export function Overview() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useData<Dashboard>("/dashboard");
  const analytics = useData<Analytics>("/analytics");
  const [period, setPeriod] = useState("7");
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState error={error || "Overview unavailable"} retry={reload} />;
  const metrics = data.metrics;
  const sales = data.dailySales.slice(-Number(period));
  const stockTotal = metrics.availableUnits + metrics.reservedUnits + metrics.soldUnits;
  const best = analytics.data?.topProducts.slice(0, 4) || [];
  return (
    <>
      <PageTitle
        eyebrow={today}
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user?.name.split(" ")[0] || "there"}.`}
        description="Here’s what’s happening in your store today."
        actions={
          <>
            <Button variant="secondary" onClick={reload} aria-label="Refresh overview">
              <RefreshCw size={15} />
            </Button>
            <Link to="/store/inventory?add=1" className="button primary">
              <Plus size={16} />
              Add product
            </Link>
          </>
        }
      />
      <div className="overview-intro">
        <span className="live-dot" />
        Your store at a glance
        <span className="intro-line" />
        <span className="muted">A little clarity for your every day.</span>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Total revenue",
            value: money(metrics.revenueCents),
            icon: CircleDollarSign,
            note: "From completed orders",
            color: "green",
          },
          {
            label: "Completed orders",
            value: metrics.completedOrders.toLocaleString(),
            icon: ShoppingBag,
            note: "Every checkout, accounted for",
            color: "blue",
          },
          {
            label: "Available units",
            value: metrics.availableUnits.toLocaleString(),
            icon: Package,
            note: `${metrics.products} products in your catalog`,
            color: "orange",
          },
          {
            label: "Active reservations",
            value: metrics.reservedUnits.toLocaleString(),
            icon: Radio,
            note: "In a shopper’s hands",
            color: "purple",
          },
        ].map((stat) => (
          <article className="stat" key={stat.label}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <span className={`stat-icon ${stat.color}`}>
                <stat.icon size={17} />
              </span>
            </div>
            <strong>{stat.value}</strong>
            <span className="stat-note">
              <span className="tiny-dot" />
              {stat.note}
            </span>
          </article>
        ))}
      </div>
      <div className="overview-main">
        <Panel
          title="The bigger picture"
          subtitle="A closer look at your store’s revenue"
          action={
            <select
              aria-label="Revenue chart period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          }
        >
          <div className="chart-summary">
            <strong>{money(sales.reduce((sum, row) => sum + row.revenueCents, 0))}</strong>
            <span>
              <span className="legend-dot" />
              Completed sales
            </span>
          </div>
          {sales.length ? (
            <Suspense
              fallback={
                <div className="revenue-chart">
                  <Loading />
                </div>
              }
            >
              <RevenueChart sales={sales} />
            </Suspense>
          ) : (
            <Empty
              title="Your next chapter starts here"
              detail="Completed orders will bring this chart to life."
            />
          )}
          <div className="chart-footer">
            <span>
              <span className="live-dot" />
              From your actual sales
            </span>
            <Link to="/store/orders">
              <ArrowLink>View transactions</ArrowLink>
            </Link>
          </div>
        </Panel>
        <Panel
          className="inventory-health"
          title="Inventory health"
          subtitle="Everything in its right place"
          action={<Package size={19} className="muted" />}
        >
          <div
            className="stock-ring"
            style={
              {
                "--available-angle": `${stockTotal ? (metrics.availableUnits / stockTotal) * 360 : 0}deg`,
                "--reserved-angle": `${stockTotal ? ((metrics.availableUnits + metrics.reservedUnits) / stockTotal) * 360 : 0}deg`,
              } as React.CSSProperties
            }
          >
            <div>
              <strong>{stockTotal}</strong>
              <span>Total units</span>
            </div>
          </div>
          <div className="stock-legend">
            {[
              { label: "Available", value: metrics.availableUnits, cls: "green" },
              { label: "Reserved", value: metrics.reservedUnits, cls: "orange" },
              { label: "Sold", value: metrics.soldUnits, cls: "gray" },
            ].map((row) => (
              <div key={row.label}>
                <span>
                  <i className={row.cls} />
                  {row.label}
                </span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          <Link className="health-link" to="/store/inventory">
            Manage inventory
            <ArrowRight size={15} />
          </Link>
        </Panel>
      </div>
      <div className="intelligence-banner">
        <span className="intelligence-symbol">
          <Sparkles size={22} strokeWidth={1.6} />
        </span>
        <div>
          <h3>A little insight. A smarter next step.</h3>
          <p>
            {data.lowStock.length
              ? `${data.lowStock.length} ${data.lowStock.length === 1 ? "product needs" : "products need"} a stock check. See what deserves your attention.`
              : "Turn your store’s activity into useful next steps with TapCart Intelligence."}
          </p>
        </div>
        <Link to="/store/intelligence" className="button secondary">
          Explore insights
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="overview-bottom">
        <Panel
          title="Recent orders"
          subtitle="The latest from your checkout"
          action={
            <Link to="/store/orders">
              <ArrowLink>View all orders</ArrowLink>
            </Link>
          }
        >
          {data.recentOrders.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.slice(0, 5).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link className="table-link" to={`/store/orders?order=${order.id}`}>
                          {shortId(order.id)}
                        </Link>
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
                      <td className="number">{money(order.totalCents)}</td>
                      <td>
                        <Status value={order.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Ready for your first order"
              detail="When a shopper checks out, you’ll see it here."
            />
          )}
        </Panel>
        <Panel
          title="Products to watch"
          subtitle="A quick pulse on your shelves"
          action={
            <Link to="/store/inventory">
              <ArrowUpRight size={17} />
              <span className="sr-only">View inventory</span>
            </Link>
          }
        >
          {data.lowStock.length ? (
            <div className="product-watch-list">
              {data.lowStock.slice(0, 4).map((product) => (
                <Link
                  to={`/store/inventory?q=${encodeURIComponent(product.sku)}`}
                  className="product-watch"
                  key={product.id}
                >
                  <ProductArt
                    category={product.category}
                    name={product.name}
                    imageUrl={product.imageUrl}
                    small
                  />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.category}</small>
                  </span>
                  <span className={`stock-count ${product.available === 0 ? "out" : ""}`}>
                    {product.available} left
                  </span>
                </Link>
              ))}
            </div>
          ) : best.length ? (
            <div className="product-watch-list">
              {best.map((product, index) => (
                <div className="product-watch" key={product.id}>
                  <span className="rank">0{index + 1}</span>
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.units} units sold</small>
                  </span>
                  <strong>{money(product.revenueCents)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Room for a little growth" detail="Add your products to get started." />
          )}
        </Panel>
      </div>
    </>
  );
}
export function Customers() {
  const { data, loading, error, reload } = useData<Customer[]>("/customers");
  const [query, setQuery] = useState("");
  const rows = (data || []).filter((customer) =>
    `${customer.name} ${customer.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="YOUR COMMUNITY"
        title="People behind the purchases."
        description="A little context for every familiar face."
        actions={
          <Button
            variant="secondary"
            disabled={!data?.length}
            onClick={() =>
              downloadCSV("tapcart-customers.csv", [
                ["Name", "Email", "Orders", "Total INR", "Last order"],
                ...(data || []).map((customer) => [
                  customer.name,
                  customer.email,
                  customer.orders,
                  customer.totalCents / 100,
                  customer.lastOrderAt,
                ]),
              ])
            }
          >
            <Download size={16} />
            Export customers
          </Button>
        }
      />
      <div className="summary-strip">
        <div>
          <Users size={20} />
          <strong>{data?.length || 0}</strong>
          <span>Customers</span>
        </div>
        <div>
          <ShoppingBag size={20} />
          <strong>{data?.reduce((sum, customer) => sum + customer.orders, 0) || 0}</strong>
          <span>Completed orders</span>
        </div>
        <div>
          <TrendingUp size={20} />
          <strong>
            {money(data?.reduce((sum, customer) => sum + customer.totalCents, 0) || 0)}
          </strong>
          <span>Lifetime sales</span>
        </div>
      </div>
      <Panel
        title="Customer directory"
        subtitle="Built from completed purchases"
        action={
          <input
            aria-label="Search customers"
            placeholder="Search name or email…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} retry={reload} />
        ) : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Orders</th>
                  <th>Total spend</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="customer-cell">
                        <span className="avatar">{customer.name.slice(0, 2).toUpperCase()}</span>
                        <strong>{customer.name}</strong>
                      </div>
                    </td>
                    <td>{customer.email}</td>
                    <td>{customer.orders}</td>
                    <td className="number">{money(customer.totalCents)}</td>
                    <td>{date(customer.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={query ? "No matching customers" : "Your community starts here"}
            detail={
              query
                ? "Try a different name or email."
                : "Customer information appears after completed purchases."
            }
          />
        )}
      </Panel>
    </>
  );
}
interface Insight {
  id: string;
  title: string;
  description: string;
  priority?: string;
  evidence?: string;
  action?: { label: string; href: string };
}
interface Insights {
  mode: string;
  summary: string;
  insights: Insight[];
  generatedAt?: string;
  forecasts: {
    productId: string;
    name: string;
    available: number;
    dailyDemand: number;
    forecast7Days: number;
    reorderQuantity: number;
    daysOfStock: number | null;
    confidence: string;
  }[];
  recommendations: { productId: string; name: string; reason: string; score: number }[];
}
interface ChatReply {
  answer: string;
  mode: string;
  evidence?: string[];
}
export function Intelligence() {
  const insights = useData<Insights>("/ai/insights");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversation, setConversation] = useState<
    { role: "user" | "assistant"; text: string; mode?: string }[]
  >([]);
  async function ask(event: FormEvent, preset?: string) {
    event.preventDefault();
    const text = preset || question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setQuestion("");
    setConversation((previous) => [...previous, { role: "user", text }]);
    try {
      const reply = await write<ChatReply>("/ai/chat", { message: text });
      setConversation((previous) => [
        ...previous,
        { role: "assistant", text: reply.answer, mode: reply.mode },
      ]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="TAPCART INTELLIGENCE"
        title="Your store has a story."
        description="Find the useful signals. Make your next move with a little more clarity."
        actions={
          <Button variant="secondary" onClick={insights.reload}>
            <RefreshCw size={15} />
            Refresh insights
          </Button>
        }
      />
      <div className="intelligence-grid">
        <div>
          <div className="insight-intro">
            <span className="intelligence-symbol">
              <Sparkles size={24} />
            </span>
            <div>
              <h2>A thoughtful second pair of eyes.</h2>
              <p>
                {insights.data?.summary ||
                  "Insights grounded in your store’s inventory and completed sales."}
              </p>
            </div>
          </div>
          <div className="mode-label">
            <span className="live-dot" />
            {insights.data?.mode === "model"
              ? "AI model with store evidence"
              : "Local statistical assistant · no language model"}
          </div>
          {insights.loading ? (
            <Loading />
          ) : insights.error ? (
            <ErrorState error={insights.error} retry={insights.reload} />
          ) : insights.data?.insights.length ? (
            insights.data.insights.map((insight, index) => (
              <Panel key={insight.id || index} className="insight-card">
                <div className="insight-number">
                  0{index + 1}
                  <ArrowUpRight size={17} />
                </div>
                <div className="eyebrow">{insight.priority || "STORE SIGNAL"}</div>
                <h3>{insight.title}</h3>
                <p>{insight.description}</p>
                {insight.evidence ? <p className="evidence-note">{insight.evidence}</p> : null}
                {insight.action && (
                  <Link to={insight.action.href}>
                    <ArrowLink>{insight.action.label}</ArrowLink>
                  </Link>
                )}
              </Panel>
            ))
          ) : (
            <Empty
              title="A fresh start"
              detail="Add products and complete orders to discover insights."
            />
          )}
        </div>
        <Panel
          title="Ask your store"
          subtitle="A conversation grounded in your data"
          className="assistant-panel"
        >
          <div className="conversation" aria-live="polite">
            {!conversation.length && (
              <div className="assistant-welcome">
                <span className="intelligence-symbol">
                  <Sparkles size={25} />
                </span>
                <h3>Curiosity looks good on you.</h3>
                <p>
                  Ask about your stock, sales or what needs attention. Start with a question below.
                </p>
                {[
                  "Which products need restocking?",
                  "How are sales performing?",
                  "What should I focus on today?",
                ].map((prompt) => (
                  <button key={prompt} onClick={(event) => ask(event, prompt)}>
                    {prompt}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            )}
            {conversation.map((entry, index) => (
              <div className={`chat-entry ${entry.role}`} key={index}>
                <small>
                  {entry.role === "user" ? "You" : "TapCart Intelligence"}
                  {entry.mode && ` · ${entry.mode}`}
                </small>
                <p>{entry.text}</p>
              </div>
            ))}
            {busy && (
              <div className="chat-entry assistant">
                <small>TapCart Intelligence</small>
                <p className="muted">Taking a look at your store…</p>
              </div>
            )}
          </div>
          {error && <ErrorState error={error} />}
          <form onSubmit={ask} className="chat-form">
            <input
              aria-label="Ask TapCart Intelligence"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What’s on your mind?"
              maxLength={1500}
            />
            <Button
              busy={busy}
              disabled={!question.trim()}
              type="submit"
              aria-label="Send question"
            >
              <Send size={17} />
            </Button>
          </form>
          <p className="assistant-footnote">
            <ShieldCheck size={12} />
            Insights inform decisions. They never change inventory or payments.
          </p>
        </Panel>
      </div>
      {!!insights.data?.forecasts.length && (
        <Panel
          className="forecast-panel"
          title="A little look ahead"
          subtitle="Seven-day stock estimates based on observed sales. Low-confidence estimates have limited history."
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Available</th>
                  <th>7-day demand</th>
                  <th>Days of stock</th>
                  <th>Suggested reorder</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {insights.data.forecasts.map((forecast) => (
                  <tr key={forecast.productId}>
                    <td>
                      <strong>{forecast.name}</strong>
                    </td>
                    <td>{forecast.available}</td>
                    <td>{forecast.forecast7Days}</td>
                    <td>
                      {forecast.daysOfStock === null
                        ? "No demand history"
                        : forecast.daysOfStock.toFixed(1)}
                    </td>
                    <td>
                      <strong>{forecast.reorderQuantity}</strong>
                    </td>
                    <td>
                      <Status value={forecast.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {!!insights.data?.recommendations.length && (
        <Panel
          className="forecast-panel"
          title="Worth a closer look"
          subtitle="Product opportunities grounded in current store activity"
        >
          <div className="recommendation-grid">
            {insights.data.recommendations.map((recommendation) => (
              <Link
                to={`/store/inventory?q=${encodeURIComponent(recommendation.name)}`}
                key={recommendation.productId}
              >
                <span className="line-icon">
                  <Sparkles size={19} />
                </span>
                <div>
                  <h3>{recommendation.name}</h3>
                  <p>{recommendation.reason}</p>
                </div>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
export function Admin({ users = false }: { users?: boolean }) {
  const stores = useData<Store[]>("/stores");
  const people = useData<(User & { createdAt: string; storeName?: string; status?: string })[]>(
    users ? "/users" : null,
  );
  const notify = useNotify();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function approval(store: Store, approved: boolean) {
    setBusyId(store.id);
    setError("");
    try {
      await write(`/stores/${store.id}/approval`, { approved });
      stores.reload();
      notify(`${store.name} ${approved ? "approved" : "access revoked"}.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId("");
    }
  }
  const list = stores.data || [];
  return (
    <>
      <PageTitle
        eyebrow="PLATFORM ADMINISTRATION"
        title={users ? "Good people. Connected stores." : "A neighborhood, growing."}
        description={
          users
            ? "Account visibility across your TapCart platform."
            : "Welcome new stores and keep your community moving."
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              stores.reload();
              people.reload();
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        }
      />
      <div className="stats-grid three">
        {[
          { label: "Registered stores", value: list.length, icon: StoreIconFallback },
          {
            label: "Awaiting approval",
            value: list.filter((store) => store.status === "PENDING").length,
            icon: Clock3,
          },
          {
            label: "Active stores",
            value: list.filter((store) => store.status === "APPROVED").length,
            icon: Check,
          },
        ].map((stat) => (
          <article className="stat" key={stat.label}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <stat.icon size={18} />
            </div>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>
      {error && <ErrorState error={error} />}
      <Panel
        title={users ? "All accounts" : "Store registrations"}
        subtitle={
          users ? "Roles and account details" : "Review pending stores or manage approved access"
        }
      >
        {stores.loading || (users && people.loading) ? (
          <Loading />
        ) : stores.error || people.error ? (
          <ErrorState error={stores.error || people.error} retry={stores.reload} />
        ) : users ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Store</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {people.data?.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <strong>{person.name}</strong>
                    </td>
                    <td>{person.email}</td>
                    <td>
                      <Status value={person.role} />
                    </td>
                    <td>{person.storeName || "—"}</td>
                    <td>{date(person.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((store) => (
                  <tr key={store.id}>
                    <td>
                      <strong>{store.name}</strong>
                      <small>{store.address}</small>
                    </td>
                    <td>
                      {store.ownerName}
                      <small>{store.email}</small>
                    </td>
                    <td>
                      <Status value={store.status} />
                    </td>
                    <td>{date(store.createdAt)}</td>
                    <td>
                      <Button
                        variant={store.status === "APPROVED" ? "secondary" : "primary"}
                        busy={busyId === store.id}
                        onClick={() => approval(store, store.status !== "APPROVED")}
                      >
                        {store.status === "APPROVED" ? "Revoke access" : "Approve store"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Room for new neighbors"
            detail="Store registrations will appear here for review."
          />
        )}
      </Panel>
    </>
  );
}
const StoreIconFallback = Package;
