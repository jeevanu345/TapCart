import { Select } from "./select";
import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  date,
  downloadCSV,
  message,
  money,
  shortId,
  useData,
  write,
  type Customer,
  type Dashboard,
  type Order,
  type Store,
  type Team,
  type User,
} from "./api";
import {
  ArrowLink,
  Button,
  CountUp,
  Empty,
  ErrorState,
  Loading,
  PageTitle,
  Panel,
  ProductArt,
  Status,
  useNotify,
} from "./ui";
import { PLANS, planById } from "../../server/plans";
const RevenueChart = lazy(() => import("./Chart"));
function Setup({ data }: { data: Dashboard }) {
  const team = useData<Team>("/team");
  const m = data.metrics;
  const [exported] = useState(() => {
    try {
      return !!localStorage.getItem("tapcart.tags-exported");
    } catch {
      return false;
    }
  });
  const steps = [
    { label: "Add your first product", done: m.products > 0, to: "/store/inventory?add=1" },
    {
      label: "Receive physical units",
      done: m.availableUnits + m.reservedUnits + m.soldUnits > 0,
      to: "/store/inventory",
    },
    { label: "Export or print tags", done: exported, to: "/store/tags" },
    {
      label: "Invite a teammate",
      done: (team.data?.members.length || 0) > 1,
      to: "/store/settings?tab=team",
    },
    { label: "Take your first order", done: data.recentOrders.length > 0, to: "/customer" },
  ];
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length || !team.data) return null;
  return (
    <section className="setup" aria-label="Setup progress">
      <div className="setup-head">
        <h2>Finish setting up</h2>
        <span>
          {done} of {steps.length}
        </span>
      </div>
      <div className="setup-steps">
        {steps.map((step) => (
          <Link to={step.to} key={step.label} data-done={step.done}>
            <span aria-hidden="true">{step.done && <Check size={11} strokeWidth={3} />}</span>
            {step.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
export function Overview() {
  const { data, error, loading, reload } = useData<Dashboard>("/dashboard");
  const pending = useData<Order[]>("/orders");
  const [period, setPeriod] = useState("14");
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (loading && !data) return <Loading rows={8} />;
  if (error || !data) return <ErrorState error={error || "Overview unavailable"} retry={reload} />;
  const metrics = data.metrics;
  const sales = data.dailySales.slice(-Number(period));
  const stockTotal = metrics.availableUnits + metrics.reservedUnits + metrics.soldUnits;
  const waiting = (pending.data || []).filter((order) => order.status === "PAYMENT_PENDING");
  const stock = [
    { label: "Available", value: metrics.availableUnits, cls: "s1" },
    { label: "Reserved", value: metrics.reservedUnits, cls: "s2" },
    { label: "Sold", value: metrics.soldUnits, cls: "s3" },
  ];
  return (
    <>
      <PageTitle
        title="Overview"
        description={today}
        actions={
          <>
            <Button variant="secondary" onClick={reload} aria-label="Refresh overview">
              <RefreshCw size={15} />
            </Button>
            <Link to="/store/inventory?add=1" className="button primary">
              <Plus size={15} />
              Add product
            </Link>
          </>
        }
      />
      <Setup data={data} />
      {waiting.length > 0 && (
        <Link to="/store/desk" className="next-action">
          <strong>
            {waiting.length} {waiting.length === 1 ? "order is" : "orders are"} waiting at the desk
          </strong>
          <span>{money(waiting.reduce((sum, order) => sum + order.totalCents, 0))} to collect</span>
          <ArrowRight size={16} />
        </Link>
      )}
      <div className="metric-strip">
        <div>
          <span>Revenue, all time</span>
          <strong>
            <CountUp value={metrics.revenueCents} format={money} step={100} />
          </strong>
          <small>Net of returns</small>
        </div>
        <div>
          <span>Completed orders</span>
          <strong>
            <CountUp value={metrics.completedOrders} />
          </strong>
          <small>
            {metrics.customers} customer{metrics.customers === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <span>Available units</span>
          <strong>
            <CountUp value={metrics.availableUnits} />
          </strong>
          <small>{metrics.products} products</small>
        </div>
        <div>
          <span>Held right now</span>
          <strong>
            <CountUp value={metrics.reservedUnits} />
          </strong>
          <small>Active reservations</small>
        </div>
      </div>
      <div className="overview-main">
        <Panel
          title={money(sales.reduce((sum, row) => sum + row.revenueCents, 0))}
          subtitle={`Revenue, last ${period} days`}
          className="chart-panel"
          action={
            <div className="segmented compact" role="group" aria-label="Revenue chart period">
              {["7", "14", "30"].map((value) => (
                <button
                  key={value}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {value}d
                </button>
              ))}
            </div>
          }
        >
          {sales.some((row) => row.revenueCents > 0) ? (
            <Suspense fallback={<div className="revenue-chart" />}>
              <RevenueChart sales={sales} />
            </Suspense>
          ) : (
            <Empty
              title="No sales in this period"
              detail="Completed orders will draw this chart."
            />
          )}
        </Panel>
        <Panel title="Stock" subtitle={`${stockTotal.toLocaleString("en-IN")} units tracked`}>
          <div className="stock-bar" aria-hidden="true">
            {stock.map((row) => (
              <i
                key={row.label}
                className={row.cls}
                style={{ flexGrow: stockTotal ? row.value / stockTotal : 0 }}
              />
            ))}
          </div>
          <dl className="stat-list">
            {stock.map((row) => (
              <div key={row.label}>
                <dt>
                  <i className={row.cls} aria-hidden="true" />
                  {row.label}
                </dt>
                <dd>{row.value.toLocaleString("en-IN")}</dd>
              </div>
            ))}
          </dl>
          <Link className="panel-link" to="/store/inventory">
            <ArrowLink>Manage inventory</ArrowLink>
          </Link>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title="Recent orders"
          action={
            <Link to="/store/orders">
              <ArrowLink>All orders</ArrowLink>
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
                    <th>Status</th>
                    <th className="number">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.slice(0, 6).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link className="table-link" to={`/store/orders?order=${order.id}`}>
                          {shortId(order.id)}
                        </Link>
                        <small>{date(order.createdAt)}</small>
                      </td>
                      <td>{order.customerName}</td>
                      <td>
                        <Status value={order.status} />
                      </td>
                      <td className="number">{money(order.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No orders yet" detail="When a shopper checks out, it appears here." />
          )}
        </Panel>
        <Panel
          title="Running low"
          action={
            <Link to="/store/inventory?stock=low">
              <ArrowLink>View all</ArrowLink>
            </Link>
          }
        >
          {data.lowStock.length ? (
            <div className="product-watch-list">
              {data.lowStock.slice(0, 5).map((product) => (
                <Link
                  to={`/store/inventory?q=${encodeURIComponent(product.sku)}`}
                  className="product-watch"
                  key={product.id}
                >
                  <ProductArt name={product.name} imageUrl={product.imageUrl} small />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.category}</small>
                  </span>
                  <span className="stock-count" data-out={product.available === 0}>
                    {product.available} left
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="Nothing is running low" detail="Every product is above your threshold." />
          )}
        </Panel>
      </div>
    </>
  );
}
export function Customers() {
  const { data, loading, error, reload } = useData<Customer[]>("/customers");
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const rows = (data || []).filter((customer) =>
    `${customer.name} ${customer.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title="Customers"
        description="Built from completed purchases."
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
            Export
          </Button>
        }
      />
      <div className="metric-strip three">
        <div>
          <span>Customers</span>
          <strong>{data?.length || 0}</strong>
        </div>
        <div>
          <span>Completed orders</span>
          <strong>{data?.reduce((sum, customer) => sum + customer.orders, 0) || 0}</strong>
        </div>
        <div>
          <span>Lifetime sales</span>
          <strong>
            {money(data?.reduce((sum, customer) => sum + customer.totalCents, 0) || 0)}
          </strong>
        </div>
      </div>
      <Panel
        title="Directory"
        action={
          <input
            aria-label="Search customers"
            placeholder="Search name or email…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      >
        {loading && !data ? (
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
            title={query ? "No matching customers" : "No customers yet"}
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
        title="Intelligence"
        description={
          insights.data?.summary || "Signals grounded in your inventory and completed sales."
        }
        actions={
          <Button variant="secondary" onClick={insights.reload}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        }
      />
      <div className="intelligence-grid">
        <div>
          <div className="mode-label">
            {insights.data?.mode === "model"
              ? "AI model with store evidence"
              : "Local statistical assistant · no language model"}
          </div>
          {insights.loading && !insights.data ? (
            <Loading />
          ) : insights.error ? (
            <ErrorState error={insights.error} retry={insights.reload} />
          ) : insights.data?.insights.length ? (
            insights.data.insights.map((insight, index) => (
              <Panel key={insight.id || index} className="insight-card">
                {insight.priority && <Status value={insight.priority} />}
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
              title="No signals yet"
              detail="Add products and complete orders to see insights."
            />
          )}
        </div>
        <Panel
          title="Ask your store"
          subtitle="Answers come from your store's data."
          className="assistant-panel"
        >
          <div className="conversation" aria-live="polite">
            {!conversation.length && (
              <div className="assistant-welcome">
                <p>Ask about stock, sales or what needs attention.</p>
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
                <p className="muted">Reading your store data…</p>
              </div>
            )}
          </div>
          {error && <ErrorState error={error} />}
          <form onSubmit={ask} className="chat-form">
            <input
              aria-label="Ask TapCart Intelligence"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question"
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
          title="Seven-day forecast"
          subtitle="Estimates from observed sales. Low-confidence rows have limited history."
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
          subtitle="Grounded in current store activity"
        >
          <div className="recommendation-grid">
            {insights.data.recommendations.map((recommendation) => (
              <Link
                to={`/store/inventory?q=${encodeURIComponent(recommendation.name)}`}
                key={recommendation.productId}
              >
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
  const [query, setQuery] = useState("");
  async function mutate(store: Store, run: () => Promise<unknown>, done: string) {
    setBusyId(store.id);
    setError("");
    try {
      await run();
      stores.reload();
      notify(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId("");
    }
  }
  const list = stores.data || [];
  const needle = query.toLowerCase();
  const shownStores = list.filter((store) =>
    `${store.name} ${store.ownerName} ${store.email}`.toLowerCase().includes(needle),
  );
  const shownPeople = (people.data || []).filter((person) =>
    `${person.name} ${person.email} ${person.storeName || ""}`.toLowerCase().includes(needle),
  );
  const count = (status: string) => list.filter((store) => store.status === status).length;
  return (
    <>
      <PageTitle
        title={users ? "Accounts" : "Stores"}
        description={
          users ? "Everyone on the platform." : "Approve new stores and manage their plans."
        }
        actions={
          <Button
            variant="secondary"
            aria-label="Refresh"
            onClick={() => {
              stores.reload();
              people.reload();
            }}
          >
            <RefreshCw size={15} />
          </Button>
        }
      />
      <div className="metric-strip">
        {[
          { label: "Registered stores", value: list.length },
          { label: "Awaiting approval", value: count("PENDING") },
          { label: "Active stores", value: count("APPROVED") },
          {
            label: "Plan requests",
            value: list.filter((store) => store.planRequested).length,
          },
        ].map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong>
              <CountUp value={stat.value} />
            </strong>
          </div>
        ))}
      </div>
      {error && <ErrorState error={error} />}
      <Panel
        title={users ? "All accounts" : "Store registrations"}
        action={
          <input
            aria-label={users ? "Search accounts" : "Search stores"}
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      >
        {(stores.loading && !stores.data) || (users && people.loading && !people.data) ? (
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
                {shownPeople.map((person) => (
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
        ) : shownStores.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Registered</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownStores.map((store) => (
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
                    <td>
                      <Select
                        aria-label={`Plan for ${store.name}`}
                        value={store.plan || "STARTER"}
                        disabled={busyId === store.id}
                        onValueChange={(value) =>
                          void mutate(
                            store,
                            () => write(`/stores/${store.id}/plan`, { plan: value }),
                            `${store.name} plan updated.`,
                          )
                        }
                      >
                        {PLANS.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name}
                          </option>
                        ))}
                      </Select>
                      {store.planRequested && (
                        <small>Requested: {planById(store.planRequested).name}</small>
                      )}
                    </td>
                    <td>{date(store.createdAt)}</td>
                    <td className="number">
                      <Button
                        variant={store.status === "APPROVED" ? "secondary" : "primary"}
                        busy={busyId === store.id}
                        onClick={() => {
                          const approved = store.status !== "APPROVED";
                          void mutate(
                            store,
                            () => write(`/stores/${store.id}/approval`, { approved }),
                            `${store.name} ${approved ? "approved" : "access revoked"}.`,
                          );
                        }}
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
          <Empty title="No stores found" detail="New registrations appear here for review." />
        )}
      </Panel>
    </>
  );
}
