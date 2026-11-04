import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Download, RefreshCw } from "lucide-react";
import {
  dateTime,
  downloadCSV,
  money,
  shortId,
  useData,
  type ActivityEvent,
  type Analytics,
} from "./api";
import { useAuth } from "./App";
import { Button, CountUp, Empty, ErrorState, Loading, PageTitle, Panel } from "./ui";
const RevenueChart = lazy(() => import("./Chart"));
const RANGES = [7, 14, 30, 90];
function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  if (!before) return <small>No sales in the prior {days} days</small>;
  const change = Math.round(((now - before) / before) * 100);
  return (
    <small>
      {change > 0 ? "+" : ""}
      {change}% vs prior {days} days
    </small>
  );
}
export function Reports() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useData<Analytics>(`/analytics?days=${days}`);
  const now = data?.current,
    before = data?.previous;
  const average = now?.orders ? now.revenueCents / now.orders : 0;
  const beforeAverage = before?.orders ? before.revenueCents / before.orders : 0;
  const biggest = Math.max(...(data?.categorySales.map((row) => row.revenueCents) || [0]), 1);
  const outcome = (type: string) =>
    data?.reservationOutcomes.find((row) => row.type === type)?.count || 0;
  function exportReport() {
    if (!data) return;
    downloadCSV(`tapcart-report-${days}d.csv`, [
      ["Date", "Revenue INR", "Orders"],
      ...data.dailySales.map((row) => [row.date, row.revenueCents / 100, row.orders]),
    ]);
  }
  return (
    <>
      <PageTitle
        title="Reports"
        description="Completed sales and how reservations turned out."
        actions={
          <>
            <div className="segmented compact" role="group" aria-label="Report period">
              {RANGES.map((value) => (
                <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>
                  {value}d
                </button>
              ))}
            </div>
            <Button variant="secondary" disabled={!data} onClick={exportReport}>
              <Download size={15} />
              Export
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : loading && !data ? (
        <Loading rows={8} />
      ) : data ? (
        <>
          <div className="metric-strip">
            <div>
              <span>Revenue</span>
              <strong>
                <CountUp value={now?.revenueCents || 0} format={money} step={100} />
              </strong>
              <Delta now={now?.revenueCents || 0} before={before?.revenueCents || 0} days={days} />
            </div>
            <div>
              <span>Orders</span>
              <strong>
                <CountUp value={now?.orders || 0} />
              </strong>
              <Delta now={now?.orders || 0} before={before?.orders || 0} days={days} />
            </div>
            <div>
              <span>Average order</span>
              <strong>
                <CountUp value={Math.round(average)} format={money} step={100} />
              </strong>
              <Delta now={average} before={beforeAverage} days={days} />
            </div>
            <div>
              <span>Units returned</span>
              <strong>
                <CountUp value={now?.returns || 0} />
              </strong>
              <small>{now?.units || 0} units kept</small>
            </div>
          </div>
          <Panel title="Revenue by day" subtitle={`Last ${days} days, net of returns`}>
            {data.dailySales.some((row) => row.revenueCents > 0) ? (
              <Suspense fallback={<div className="revenue-chart" />}>
                <RevenueChart sales={data.dailySales} />
              </Suspense>
            ) : (
              <Empty title="No sales in this period" detail="Try a longer period." />
            )}
          </Panel>
          <div className="split">
            <Panel title="Sales by category">
              {data.categorySales.length ? (
                <div className="bars">
                  {data.categorySales.map((row) => (
                    <div key={row.category}>
                      <span>{row.category}</span>
                      <strong>{money(row.revenueCents)}</strong>
                      <i>
                        <b style={{ transform: `scaleX(${row.revenueCents / biggest})` }} />
                      </i>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No category sales yet" />
              )}
            </Panel>
            <Panel title="Top products">
              {data.topProducts.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Units</th>
                        <th className="number">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.slice(0, 6).map((row) => (
                        <tr key={row.id}>
                          <td>
                            <Link
                              className="table-link"
                              to={`/store/inventory?q=${encodeURIComponent(row.name)}`}
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td>{row.units}</td>
                          <td className="number">{money(row.revenueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No product sales yet" />
              )}
            </Panel>
          </div>
          <div className="split">
            <Panel title="Payment methods" subtitle="Completed orders in this period">
              {data.paymentMix.length ? (
                <dl className="stat-list">
                  {data.paymentMix.map((row) => (
                    <div key={row.method}>
                      <dt>
                        {row.method === "DESK"
                          ? "Pay at desk"
                          : row.method === "CARD"
                            ? "Card"
                            : "Development"}
                      </dt>
                      <dd>
                        {row.orders} orders · {money(row.revenueCents)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Empty title="No completed orders" />
              )}
            </Panel>
            <Panel title="Reservations" subtitle="What happened to shopper holds in this period">
              <dl className="stat-list">
                <div>
                  <dt>Started</dt>
                  <dd>{outcome("InventoryReserved")}</dd>
                </div>
                <div>
                  <dt>Released by shopper</dt>
                  <dd>{outcome("InventoryReleased")}</dd>
                </div>
                <div>
                  <dt>Expired unpaid</dt>
                  <dd>{outcome("ReservationExpired")}</dd>
                </div>
              </dl>
            </Panel>
          </div>
        </>
      ) : null}
    </>
  );
}
export const eventLabel = (row: Pick<ActivityEvent, "eventType" | "payload">) => {
  const by = row.payload?.by ? ` by ${String(row.payload.by)}` : "";
  const labels: Record<string, string> = {
    InventoryReserved: "Reserved by a shopper",
    InventoryReleased: "Released back to the shelf",
    ReservationExpired: "Reservation expired",
    CheckoutPrepared: "Checkout started",
    PaymentReceived: "Payment received",
    PaymentFailed: "Payment failed",
    InventorySold: "Sale recorded",
    InventoryReturned: "Returned to inventory",
    RefundRequired: "Refund required",
    RefundConfirmed: "Refund confirmed",
    UnitsReceived: `${String(row.payload?.count ?? "")} units received`,
    WorkspaceUpdated: `Store settings updated${by}`,
    PlanRequested: row.payload?.plan
      ? `${String(row.payload.plan).toLowerCase()} plan requested${by}`
      : `Plan request withdrawn${by}`,
    PlanChanged: `Plan changed to ${String(row.payload?.plan ?? "").toLowerCase()}`,
    TeamInviteCreated: `Teammate invited${by}`,
    TeamMemberJoined: `${String(row.payload?.name ?? "A teammate")} joined the team`,
    TeamMemberRemoved: `Teammate removed${by}`,
  };
  return labels[row.eventType] || row.eventType;
};
export function Activity() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useData<ActivityEvent[]>("/activity?limit=100");
  const [filter, setFilter] = useState("all");
  const groups: Record<string, string[]> = {
    sales: [
      "CheckoutPrepared",
      "PaymentReceived",
      "PaymentFailed",
      "InventorySold",
      "InventoryReturned",
      "RefundRequired",
      "RefundConfirmed",
    ],
    holds: ["InventoryReserved", "InventoryReleased", "ReservationExpired"],
    team: [
      "UnitsReceived",
      "WorkspaceUpdated",
      "PlanRequested",
      "PlanChanged",
      "TeamInviteCreated",
      "TeamMemberJoined",
      "TeamMemberRemoved",
    ],
  };
  const rows = (data || []).filter(
    (row) => filter === "all" || groups[filter].includes(row.eventType),
  );
  return (
    <>
      <PageTitle
        title="Activity"
        description="The durable record behind every change, newest first."
        actions={
          <Button variant="secondary" onClick={reload} aria-label="Refresh activity">
            <RefreshCw size={15} />
          </Button>
        }
      />
      <Panel
        action={
          <div className="segmented compact" role="group" aria-label="Filter activity">
            {[
              ["all", "All"],
              ["sales", "Sales"],
              ["holds", "Holds"],
              ["team", "Workspace"],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <ErrorState error={error} retry={reload} />
        ) : loading && !data ? (
          <Loading rows={8} />
        ) : rows.length ? (
          <ol className="timeline">
            {rows.map((row) => (
              <li key={row.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{eventLabel(row)}</strong>
                  <small>
                    {row.productName && `${row.productName} · `}
                    {row.unitCode && `${row.unitCode} · `}
                    {row.totalCents !== null && (
                      <>
                        {user?.role === "STORE" ? (
                          <Link to={`/store/orders?order=${row.aggregateId}`}>
                            {shortId(row.aggregateId)}
                          </Link>
                        ) : (
                          shortId(row.aggregateId)
                        )}
                        {` · ${money(row.totalCents)} · `}
                      </>
                    )}
                    {dateTime(row.createdAt)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No activity yet" detail="Reservations and sales will appear here." />
        )}
      </Panel>
    </>
  );
}
