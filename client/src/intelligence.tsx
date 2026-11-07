import { Select } from "./select";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search, Sparkles, Upload, RefreshCw } from "lucide-react";
import { useAuth } from "./App";
import { api, write, useData, message, money, dateTime, type Store, type Product } from "./api";
import {
  Button,
  Panel,
  PageTitle,
  Loading,
  ErrorState,
  Empty,
  Modal,
  Status,
  useNotify,
} from "./ui";
import type { Forecast } from "../../server/intelligence/forecast";
import type { ExtractedLine } from "../../server/intelligence/invoices";
import type { CatalogItem } from "../../server/intelligence/catalog";
import type { Evidence } from "../../server/intelligence/assistant";
type PlanningForecast = Forecast & {
  supplierId: string | null;
  supplierName: string | null;
  leadTimeOverride: number | null;
};
type Path = (url: string) => string;
interface Supplier {
  id: string;
  name: string;
  active: boolean;
  leadTimeDays: number;
}
interface Extraction {
  id: string;
  sourceName: string;
  engine: string;
  result: { invoiceNumber: string; lines: ExtractedLine[]; warnings: string[] };
  draftId: string | null;
  createdAt: string;
}
export function IntelligenceLab() {
  const { user } = useAuth(),
    [params, setParams] = useSearchParams();
  const stores = useData<Store[]>(user?.role === "ADMIN" ? "/stores" : null);
  const storeId = user?.role === "ADMIN" ? params.get("storeId") || "" : user?.storeId || "";
  const tab = params.get("tab") || "forecasts";
  const path: Path = (url) =>
    `${url}${url.includes("?") ? "&" : "?"}storeId=${encodeURIComponent(storeId)}`;
  const tabs = [
    ["forecasts", "Replenishment"],
    ["invoices", "Invoice review"],
    ["search", "Catalog search"],
    ["alerts", "Anomalies"],
    ["assistant", "Assistant"],
  ];
  return (
    <>
      <PageTitle
        title="Intelligence lab"
        description="Plan replenishment, review documents and investigate your store records."
      />
      {user?.role === "ADMIN" && (
        <label>
          Store
          <Select
            value={storeId}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              next.set("storeId", value);
              setParams(next);
            }}
          >
            <option value="">Choose an approved store</option>
            {stores.data
              ?.filter((s) => s.status === "APPROVED")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </label>
      )}
      <nav className="lab-tabs" aria-label="Intelligence tools">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("tab", id);
              setParams(next);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {!storeId ? (
        <Empty title="Choose a store" detail="Store records are isolated by workspace." />
      ) : tab === "invoices" ? (
        <InvoiceReview key={storeId} path={path} />
      ) : tab === "search" ? (
        <CatalogSearch key={storeId} path={path} />
      ) : tab === "alerts" ? (
        <Alerts key={storeId} path={path} />
      ) : tab === "assistant" ? (
        <Assistant key={storeId} path={path} />
      ) : (
        <Forecasts key={storeId} path={path} />
      )}
    </>
  );
}
function Forecasts({ path }: { path: Path }) {
  const data = useData<PlanningForecast[]>(path("/intelligence/forecasts")),
    [editing, setEditing] = useState<PlanningForecast | null>(null);
  return (
    <>
      <Panel>
        <div className="panel-heading">
          <div>
            <h2>Replenishment forecast</h2>
            <p>
              Supplier lead time + review period, less stock available and open purchase orders.
              Models compete on rolling historical forecasts.
            </p>
          </div>
          <Button variant="secondary" onClick={data.reload}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        </div>
        {data.error ? (
          <ErrorState error={data.error} retry={data.reload} />
        ) : data.loading && !data.data ? (
          <Loading />
        ) : data.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product / model</th>
                  <th>Available / on order</th>
                  <th>Planning horizon</th>
                  <th>Demand / buffer</th>
                  <th>Suggested purchase</th>
                  <th>Backtest</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((f) => (
                  <tr key={f.productId}>
                    <td>
                      <strong>{f.name}</strong>
                      <small>
                        {f.method} · {f.observedDays} days observed
                      </small>
                      <small>{f.supplierName || "No supplier assigned"}</small>
                    </td>
                    <td>
                      {f.available} / {f.onOrder}
                    </td>
                    <td>
                      {f.leadTimeDays} + {f.reviewDays} days
                    </td>
                    <td>
                      {f.planningDemand} / {f.safetyBuffer}
                    </td>
                    <td>
                      <strong>{f.reorderQuantity}</strong>
                      <small>Target {f.targetStock}</small>
                    </td>
                    <td>
                      {f.backtest.mae === null
                        ? "Insufficient history"
                        : `MAE ${f.backtest.mae} units`}
                      <small>
                        {f.backtest.origins} origins · {f.backtest.horizonDays}-day horizon
                      </small>
                      <small>
                        {f.backtest.wape === null ? "WAPE unavailable" : `WAPE ${f.backtest.wape}%`}
                      </small>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setEditing(f)}>
                        Edit policy
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No active products" detail="Add catalog products to start planning." />
        )}
      </Panel>
      <p className="quiet-note">
        India store calendar; incomplete today is excluded. Weekday seasonality needs repeated
        weeks. Sales can underestimate demand during stockouts; the buffer reflects historical
        errors and is not a service-level guarantee.
      </p>
      {editing && (
        <PlanningModal
          item={editing}
          path={path}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}
function PlanningModal({
  item,
  path,
  close,
  saved,
}: {
  item: PlanningForecast;
  path: Path;
  close: () => void;
  saved: () => void;
}) {
  const suppliers = useData<Supplier[]>(path("/suppliers")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await write(
        path(`/intelligence/planning/${item.productId}`),
        {
          supplierId: form.get("supplierId") || null,
          leadTimeDays: form.get("leadTimeDays") === "" ? null : Number(form.get("leadTimeDays")),
          reviewDays: Number(form.get("reviewDays")),
          minimumStock: Number(form.get("minimumStock")),
        },
        "PATCH",
      );
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Plan ${item.name}`} onClose={close}>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Supplier
          <Select name="supplierId" defaultValue={item.supplierId ?? ""}>
            <option value="">Unassigned</option>
            {suppliers.data
              ?.filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.leadTimeDays} days
                </option>
              ))}
          </Select>
        </label>
        <label>
          Lead time override (days)
          <input
            name="leadTimeDays"
            type="number"
            min="0"
            max="365"
            defaultValue={item.leadTimeOverride ?? ""}
            placeholder="Use supplier lead time, or 7 days"
          />
        </label>
        <label>
          Review interval (days)
          <input
            name="reviewDays"
            type="number"
            min="1"
            max="90"
            defaultValue={item.reviewDays}
            required
          />
        </label>
        <label>
          Minimum stock target
          <input
            name="minimumStock"
            type="number"
            min="0"
            max="1000000"
            defaultValue={item.minimumStock}
            required
          />
        </label>
        {error && <ErrorState error={error} />}
        <Button type="submit" busy={busy}>
          Save replenishment policy
        </Button>
      </form>
      <details>
        <summary>Compare backtest candidates</summary>
        <ul>
          {item.backtest.candidates.map((c) => (
            <li key={c.method}>
              {c.method}:{" "}
              {c.mae === null ? "No validation history" : `MAE ${c.mae}, WAPE ${c.wape ?? "n/a"}%`}
            </li>
          ))}
        </ul>
      </details>
    </Modal>
  );
}
function InvoiceReview({ path }: { path: Path }) {
  const history = useData<Extraction[]>(path("/intelligence/invoices")),
    products = useData<Product[]>(path("/products")),
    suppliers = useData<Supplier[]>(path("/suppliers"));
  const [selected, setSelected] = useState<Extraction | null>(null),
    [lines, setLines] = useState<ExtractedLine[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invoiceNumber, setInvoiceNumber] = useState(""),
    [supplier, setSupplier] = useState("");
  const key = useRef(crypto.randomUUID()),
    navigate = useNavigate();
  function select(item: Extraction) {
    setSelected(item);
    setLines(item.result.lines);
    setInvoiceNumber(item.result.invoiceNumber);
    key.current = crypto.randomUUID();
  }
  async function extract(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget),
      file = form.get("invoice");
    if (!(file instanceof File) || !file.size) form.delete("invoice");
    try {
      const item = await api<Extraction>(path("/intelligence/invoices"), {
        method: "POST",
        body: form,
      });
      select(item);
      history.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function change(index: number, update: Partial<ExtractedLine>) {
    setLines((previous) =>
      previous.map((line, i) => (i === index ? { ...line, ...update } : line)),
    );
    key.current = crypto.randomUUID();
  }
  async function save() {
    if (!selected) return;
    setError("");
    setBusy(true);
    try {
      const result = await write<{ draftId: string }>(
        path(`/intelligence/invoices/${selected.id}/draft`),
        {
          supplierId: supplier || undefined,
          invoiceNumber,
          notes: `Reviewed extraction ${selected.id}; ${selected.sourceName}`,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCostCents: l.unitCostCents,
          })),
        },
        "POST",
        key.current,
      );
      navigate(`/store/purchases?draft=${result.draftId}&${path("").slice(1)}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel>
        <h2>Extract supplier invoice</h2>
        <p>
          Local text, PDF or OCR extraction. Upload up to 8 MB and five PDF pages, or paste rows as
          “SKU, quantity, unit cost”.
        </p>
        <form className="form-stack" onSubmit={extract}>
          <label>
            Invoice file
            <input name="invoice" type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt" />
          </label>
          <label>
            Or paste invoice text
            <textarea
              name="text"
              rows={4}
              maxLength={100000}
              placeholder={"Invoice # SUP-104\nCOFFEE-01, 12, 180.00"}
            />
          </label>
          <Button type="submit" busy={busy}>
            <Upload size={16} />
            Extract for review
          </Button>
        </form>
        {error && <ErrorState error={error} />}
      </Panel>
      {selected && (
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Review extracted lines</h2>
              <p>
                {selected.sourceName} · {selected.engine} · {lines.length} lines
              </p>
            </div>
            <Status value={selected.draftId ? "DRAFT_CREATED" : "NEEDS_REVIEW"} />
          </div>
          {selected.result.warnings.map((w) => (
            <p className="quiet-note" key={w}>
              {w}
            </p>
          ))}
          <div className="lab-inputs">
            <label>
              Invoice number
              <input
                value={invoiceNumber}
                onChange={(e) => {
                  setInvoiceNumber(e.target.value);
                  key.current = crypto.randomUUID();
                }}
                maxLength={200}
              />
            </label>
            <label>
              Supplier
              <Select
                value={supplier}
                onValueChange={(value) => {
                  setSupplier(value);
                  key.current = crypto.randomUUID();
                }}
              >
                <option value="">Choose before purchase approval</option>
                {suppliers.data
                  ?.filter((s) => s.active)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source / evidence</th>
                  <th>Catalog product</th>
                  <th>Quantity</th>
                  <th>Unit cost (₹)</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{l.description}</strong>
                      <small>{l.source}</small>
                      <small>{l.confidence}</small>
                    </td>
                    <td>
                      <Select
                        aria-label={`Product for line ${i + 1}`}
                        value={l.productId ?? ""}
                        onValueChange={(value) => change(i, { productId: value || null })}
                      >
                        <option value="">Choose product</option>
                        {products.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <input
                        aria-label={`Quantity for line ${i + 1}`}
                        type="number"
                        min="1"
                        max="10000"
                        value={l.quantity ?? ""}
                        onChange={(e) =>
                          change(i, {
                            quantity: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Unit cost for line ${i + 1}`}
                        type="number"
                        min="0"
                        max="1000000"
                        step="0.01"
                        value={l.unitCostCents === null ? "" : l.unitCostCents / 100}
                        onChange={(e) =>
                          change(i, {
                            unitCostCents:
                              e.target.value === ""
                                ? null
                                : Math.round(Number(e.target.value) * 100),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setLines(lines.filter((_, n) => n !== i));
                          key.current = crypto.randomUUID();
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() =>
                setLines([
                  ...lines,
                  {
                    source: "Manually entered",
                    description: "Manual line",
                    productId: null,
                    quantity: 1,
                    unitCostCents: 0,
                    confidence: "UNMATCHED",
                    warnings: [],
                  },
                ])
              }
            >
              Add line
            </Button>
            <Button
              busy={busy}
              disabled={
                !!selected.draftId ||
                !lines.length ||
                lines.some((l) => !l.productId || !l.quantity || l.unitCostCents === null)
              }
              onClick={save}
            >
              Create reviewed receiving draft
            </Button>
          </div>
          <p className="quiet-note">
            Creating a draft does not change inventory. Approve the purchase and record quantities
            received in Purchasing.
          </p>
        </Panel>
      )}
      <Panel>
        <h2>Extraction history</h2>
        {history.error ? (
          <ErrorState error={history.error} retry={history.reload} />
        ) : history.loading && !history.data ? (
          <Loading />
        ) : history.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Engine</th>
                  <th>Created</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((item) => (
                  <tr key={item.id}>
                    <td>{item.sourceName}</td>
                    <td>{item.engine}</td>
                    <td>{dateTime(item.createdAt)}</td>
                    <td>
                      <Button variant="ghost" onClick={() => select(item)}>
                        {item.draftId ? "View extraction" : "Review"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No extracted invoices"
            detail="Upload or paste a supplier document above."
          />
        )}
      </Panel>
    </>
  );
}
function CatalogSearch({ path }: { path: Path }) {
  const [query, setQuery] = useState("coffee under ₹500"),
    [result, setResult] = useState<{
      mode: string;
      results: (CatalogItem & { score: number })[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await api(path(`/intelligence/search?q=${encodeURIComponent(query)}`)));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <h2>Find products in your words</h2>
      <p>
        Price filters are enforced before ranking. Semantic mode uses a local sentence-embedding
        model; a labeled keyword mode is available before model installation.
      </p>
      <form onSubmit={submit} className="lab-search">
        <label>
          Catalog request
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={300}
            required
          />
        </label>
        <Button type="submit" busy={busy}>
          <Search size={16} />
          Search catalog
        </Button>
      </form>
      {error && <ErrorState error={error} />}{" "}
      {result && (
        <>
          <p className="quiet-note">
            Mode: {result.mode} · {result.results.length} matches
          </p>
          {result.results.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.sku}</small>
                      </td>
                      <td>{p.category}</td>
                      <td>{money(p.priceCents)}</td>
                      <td>{p.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No matching products"
              detail="Try fewer words or a different price limit."
            />
          )}
        </>
      )}
    </Panel>
  );
}
interface Alert {
  id: string;
  kind: string;
  title: string;
  severity: string;
  status: string;
  evidence: Record<string, unknown>;
  note: string;
  lastSeenAt: string;
}
function Alerts({ path }: { path: Path }) {
  const alerts = useData<Alert[]>(path("/intelligence/alerts")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Alert | null>(null),
    notify = useNotify();
  async function scan() {
    setBusy(true);
    try {
      await write(path("/intelligence/alerts/scan"), {});
      alerts.reload();
      notify("Store records checked.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await write(
        path(`/intelligence/alerts/${selected.id}`),
        { status: form.get("status"), note: form.get("note") },
        "PATCH",
      );
      setSelected(null);
      alerts.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel>
        <div className="panel-heading">
          <div>
            <h2>Operational anomalies</h2>
            <p>
              Explainable signals for reservation bursts, refunds, inventory-ledger discrepancies
              and unsettled payments. Staff decide what action to take.
            </p>
          </div>
          <Button busy={busy} onClick={scan}>
            <RefreshCw size={16} />
            Check store records
          </Button>
        </div>
        {error && <ErrorState error={error} />}{" "}
        {alerts.error ? (
          <ErrorState error={alerts.error} retry={alerts.reload} />
        ) : alerts.loading && !alerts.data ? (
          <Loading />
        ) : alerts.data?.length ? (
          <div className="lab-alerts">
            {alerts.data.map((a) => (
              <article key={a.id}>
                <div className="panel-heading">
                  <h3>{a.title}</h3>
                  <Status value={a.status} />
                </div>
                <p>
                  {a.severity} · Last observed {dateTime(a.lastSeenAt)}
                </p>
                <details>
                  <summary>Evidence and detection rule</summary>
                  <pre>{JSON.stringify(a.evidence, null, 2)}</pre>
                </details>
                {a.note && <p>Review: {a.note}</p>}
                <Button variant="secondary" onClick={() => setSelected(a)}>
                  Review alert
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No recorded anomalies"
            detail="Run a check to evaluate the current records. A clean check does not prove that fraud is absent."
          />
        )}
      </Panel>
      {selected && (
        <Modal title="Review operational alert" onClose={() => setSelected(null)}>
          <p>{selected.title}</p>
          <form className="form-stack" onSubmit={review}>
            <label>
              Decision
              <Select name="status">
                <option value="ACKNOWLEDGED">Acknowledge for investigation</option>
                <option value="DISMISSED">Dismiss with reason</option>
                <option value="RESOLVED">Resolve with reason</option>
              </Select>
            </label>
            <label>
              Review note
              <textarea
                name="note"
                required
                minLength={3}
                maxLength={1000}
                defaultValue={selected.note}
              />
            </label>
            <Button type="submit" busy={busy}>
              Save review
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Assistant({ path }: { path: Path }) {
  const [question, setQuestion] = useState("What needs replenishment?"),
    [language, setLanguage] = useState("en"),
    [answer, setAnswer] = useState<{ answer: string; evidence: Evidence[]; mode: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setAnswer(await write(path("/intelligence/assistant"), { message: question, language }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <h2>Ask your store</h2>
      <p>
        Answers use authorized inventory, sales and payment records. Every answer includes the
        records or aggregates used.
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Answer language
          <Select value={language} onValueChange={(value) => setLanguage(value)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="kn">ಕನ್ನಡ</option>
          </Select>
        </label>
        <label>
          Your question
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={1500}
            required
          />
        </label>
        <Button type="submit" busy={busy}>
          <Sparkles size={16} />
          Ask store assistant
        </Button>
      </form>
      {error && <ErrorState error={error} />}{" "}
      {answer && (
        <div className="lab-answer" role="status">
          <p lang={language}>{answer.answer}</p>
          <small>Mode: {answer.mode}</small>
          <h3>Evidence</h3>
          {answer.evidence.map((e, i) => (
            <details key={i}>
              <summary>
                <Link to={e.href}>{e.label}</Link>
              </summary>
              <pre>{JSON.stringify(e.facts, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}
