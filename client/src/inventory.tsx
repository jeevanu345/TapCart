import { AutocompleteInput } from "./autocomplete";
import { Select } from "./select";
import { NfcTools } from "./nfc";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Copy,
  Download,
  FileSpreadsheet,
  History,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  dateTime,
  downloadCSV,
  message,
  money,
  parseCSV,
  useData,
  write,
  type Product,
  type Unit,
  type Workspace,
} from "./api";
import { eventLabel } from "./reports";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageTitle,
  Panel,
  ProductArt,
  Status,
  useNotify,
} from "./ui";
type SortKey = "name" | "priceCents" | "available" | "reserved";
export function Inventory() {
  const products = useData<Product[]>("/products");
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState(params.get("stock") || "all");
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: "name", up: true });
  const workspace = useData<Workspace>("/workspace");
  const threshold = workspace.data?.store.lowStockThreshold ?? 5;
  const [editing, setEditing] = useState<Product | "new" | null>(params.has("add") ? "new" : null);
  const [receiving, setReceiving] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [unitsFor, setUnitsFor] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const receiveKey = useRef(crypto.randomUUID());
  const notify = useNotify();
  useEffect(() => {
    setQuery(params.get("q") || "");
  }, [params]);
  const list = (products.data || []).filter((product) => product.active);
  const categories = [...new Set(list.map((product) => product.category))];
  const filtered = list.filter(
    (product) =>
      `${product.name} ${product.sku} ${product.category}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (category === "all" || product.category === category) &&
      (stock === "all" ||
        (stock === "low"
          ? product.available > 0 && product.available <= threshold
          : stock === "out"
            ? product.available === 0
            : product.available > threshold)),
  );
  const direction = sort.up ? 1 : -1;
  filtered.sort((a, b) =>
    sort.key === "name"
      ? a.name.localeCompare(b.name) * direction
      : (a[sort.key] - b[sort.key]) * direction,
  );
  const sortBy = (key: SortKey) => () =>
    setSort((value) => ({ key, up: value.key === key ? !value.up : key === "name" }));
  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.up ? "ascending" : "descending") : "none"}>
      <button className="sort-button" onClick={sortBy(key)}>
        {label}
        {sort.key === key && (sort.up ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
  function close() {
    setEditing(null);
    setReceiving(null);
    setDeleting(null);
    setError("");
    if (params.has("add")) {
      params.delete("add");
      setParams(params, { replace: true });
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const body = {
        sku: String(form.get("sku")).trim(),
        name: String(form.get("name")).trim(),
        description: form.get("description"),
        category: form.get("category"),
        priceCents: Math.round(Number(form.get("price")) * 100),
        imageUrl: form.get("imageUrl") || "",
      };
      const product = await write<Product>(
        editing === "new" ? "/products" : `/products/${editing?.id}`,
        body,
        editing === "new" ? "POST" : "PATCH",
      );
      const quantity = Number(form.get("quantity"));
      if (editing === "new" && quantity > 0)
        await write("/units", { productId: product.id, quantity }, "POST", crypto.randomUUID());
      notify(editing === "new" ? "Product added to your catalog." : "Product details updated.");
      close();
      products.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(new FormData(event.currentTarget).get("quantity"));
    setBusy(true);
    setError("");
    try {
      await write("/units", { productId: receiving?.id, quantity }, "POST", receiveKey.current);
      notify(`${quantity} physical units received. Their NFC links are ready in Tag studio.`);
      close();
      products.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await write(`/products/${deleting.id}`, {}, "DELETE");
      notify("Product archived. Its unit and sale history remain available.");
      close();
      products.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function exportProducts() {
    downloadCSV("tapcart-inventory.csv", [
      ["sku", "name", "category", "price", "quantity", "description"],
      ...filtered.map((product) => [
        product.sku,
        product.name,
        product.category,
        product.priceCents / 100,
        product.available,
        product.description,
      ]),
    ]);
    notify(`${filtered.length} products exported.`);
  }
  async function importCSV(file: File) {
    setImporting(true);
    setError("");
    try {
      const rows = parseCSV(await file.text());
      const headers = rows.shift()?.map((header) => header.trim().replace(/^\uFEFF/, "")) || [];
      if (
        !["sku", "name", "category", "price", "quantity"].every((header) =>
          headers.includes(header),
        )
      )
        throw new Error(
          "CSV needs sku, name, category, price and quantity columns. Download the template to get started.",
        );
      if (rows.length > 200) throw new Error("Import up to 200 products at once.");
      const converted = rows.map((row, index) => {
        const read = (key: string) => row[headers.indexOf(key)]?.trim() || "";
        const amount = Number(read("price"));
        const quantity = Number(read("quantity"));
        if (
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > 1000000 ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        )
          throw new Error(`Row ${index + 2}: price must be ₹0–1,000,000 and quantity 1–100.`);
        return [
          read("sku"),
          read("name"),
          read("category"),
          Math.round(amount * 100),
          quantity,
          read("description"),
          read("imageUrl"),
        ];
      });
      const csv = [
        ["sku", "name", "category", "priceCents", "quantity", "description", "imageUrl"],
        ...converted,
      ]
        .map((row) => row.map((cell) => '"' + String(cell).replaceAll('"', '""') + '"').join(","))
        .join("\r\n");
      const result = await write<{ products: number; units: number }>("/products/import", { csv });
      notify(`${result.products} products and ${result.units} physical units imported.`);
      products.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <>
      <PageTitle
        title="Inventory"
        description="Products, and every physical unit behind them."
        actions={
          <>
            <Button variant="secondary" onClick={() => fileInput.current?.click()} busy={importing}>
              <Upload size={16} />
              Import CSV
            </Button>
            <Button
              onClick={() => {
                setError("");
                setEditing("new");
              }}
            >
              <Plus size={16} />
              Add product
            </Button>
          </>
        }
      />
      <input
        className="sr-only"
        tabIndex={-1}
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        aria-label="Import product CSV"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importCSV(file);
        }}
      />
      <div className="metric-strip three">
        <div>
          <span>Products</span>
          <strong>{list.length}</strong>
        </div>
        <div>
          <span>Available units</span>
          <strong>{list.reduce((sum, product) => sum + product.available, 0)}</strong>
        </div>
        <div>
          <span>At or below {threshold} units</span>
          <strong>{list.filter((product) => product.available <= threshold).length}</strong>
        </div>
      </div>
      {error && !editing && !receiving && !deleting && <ErrorState error={error} />}
      <Panel>
        <div className="inventory-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search products"
              placeholder="Search products, SKU or category…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <Select
            aria-label="Filter category"
            value={category}
            onValueChange={(value) => setCategory(value)}
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
          <Select
            aria-label="Filter stock"
            value={stock}
            onValueChange={(value) => setStock(value)}
          >
            <option value="all">All stock levels</option>
            <option value="available">Healthy stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
          <Button variant="secondary" onClick={exportProducts} disabled={!filtered.length}>
            <Download size={15} />
            Export
          </Button>
        </div>
        {products.loading && !products.data ? (
          <Loading />
        ) : products.error ? (
          <ErrorState error={products.error} retry={products.reload} />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  {header("name", "Product")}
                  <th>Category</th>
                  {header("priceCents", "Price")}
                  {header("available", "Available")}
                  {header("reserved", "Reserved")}
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <button className="product-cell" onClick={() => setUnitsFor(product)}>
                        <ProductArt
                          category={product.category}
                          name={product.name}
                          imageUrl={product.imageUrl}
                          small
                        />
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.sku}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="category-label">{product.category}</span>
                    </td>
                    <td className="number">{money(product.priceCents)}</td>
                    <td>
                      <strong>{product.available}</strong>
                    </td>
                    <td>{product.reserved}</td>
                    <td>
                      <Status
                        value={
                          product.available === 0
                            ? "OUT_OF_STOCK"
                            : product.available <= threshold
                              ? "LOW_STOCK"
                              : "IN_STOCK"
                        }
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Receive stock for ${product.name}`}
                          title="Receive units"
                          onClick={() => {
                            setError("");
                            receiveKey.current = crypto.randomUUID();
                            setReceiving(product);
                          }}
                        >
                          <Plus size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Edit ${product.name}`}
                          title="Edit product"
                          onClick={() => {
                            setError("");
                            setEditing(product);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Archive ${product.name}`}
                          title="Archive product"
                          onClick={() => {
                            setError("");
                            setDeleting(product);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={list.length ? "No products found" : "Add your first product"}
            detail={
              list.length
                ? "Try a different search or stock filter."
                : "Then receive its physical units to create their tags."
            }
          >
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus size={16} />
              Add a product
            </Button>
          </Empty>
        )}
        <div className="table-footer">
          <span>
            {filtered.length} of {list.length} products
          </span>
          <button
            className="text-button"
            onClick={() =>
              downloadCSV("tapcart-import-template.csv", [
                ["sku", "name", "category", "price", "quantity", "description"],
                ["EXAMPLE-001", "Example product", "Essentials", "99", "1", "Product description"],
              ])
            }
          >
            <FileSpreadsheet size={14} />
            Download import template
          </button>
        </div>
      </Panel>
      <p className="quiet-note">
        Every physical unit has its own identity.{" "}
        <Link to="/store/tags">
          Open Tag studio <ArrowRight size={12} />
        </Link>
      </p>
      {editing && (
        <Modal
          title={editing === "new" ? "Add product" : "Edit product"}
          description="Each physical unit you receive gets its own NFC identity."
          onClose={close}
        >
          <form className="form-stack" onSubmit={save}>
            <div className="form-grid">
              <label>
                Product name
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editing === "new" ? "" : editing.name}
                />
              </label>
              <label>
                SKU
                <input
                  name="sku"
                  required
                  maxLength={80}
                  defaultValue={editing === "new" ? "" : editing.sku}
                />
              </label>
              <label>
                Category
                <AutocompleteInput
                  name="category"
                  aria-label="Category"
                  required
                  maxLength={80}
                  defaultValue={editing === "new" ? "" : editing.category}
                  options={categories}
                />
              </label>
              <label>
                Price (₹)
                <input
                  name="price"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  required
                  defaultValue={editing === "new" ? "" : editing.priceCents / 100}
                />
              </label>
              {editing === "new" && (
                <label>
                  Initial physical units
                  <input
                    name="quantity"
                    type="number"
                    min="0"
                    max="500"
                    step="1"
                    defaultValue="0"
                    required
                  />
                </label>
              )}
            </div>
            <label>
              Description
              <textarea
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={editing === "new" ? "" : editing.description}
              />
            </label>
            <label>
              Product image URL (optional)
              <input
                name="imageUrl"
                type="url"
                defaultValue={editing === "new" ? "" : editing.imageUrl}
                placeholder="https://…"
              />
            </label>
            {error && <ErrorState error={error} />}
            <div className="modal-actions">
              <Button variant="secondary" type="button" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" busy={busy}>
                {editing === "new" ? "Add product" : "Save changes"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {receiving && (
        <Modal title="Receive units" description={receiving.name} onClose={close}>
          <form className="form-stack" onSubmit={receive}>
            <label>
              Quantity to receive
              <input
                name="quantity"
                type="number"
                min="1"
                max="500"
                step="1"
                defaultValue="1"
                required
              />
            </label>
            <p className="form-hint">
              Each unit receives a unique identifier and NFC link. Existing units stay unchanged.
            </p>
            {error && <ErrorState error={error} />}
            <Button type="submit" busy={busy}>
              <Plus size={16} />
              Receive units
            </Button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Archive this product?"
          description={`${deleting.name} will be removed from your active catalog. Existing unit and order records remain available.`}
          onClose={close}
        >
          {error && <ErrorState error={error} />}
          <div className="modal-actions">
            <Button variant="secondary" onClick={close}>
              Keep product
            </Button>
            <Button variant="danger" busy={busy} onClick={remove}>
              Archive product
            </Button>
          </div>
        </Modal>
      )}
      {unitsFor && (
        <Modal
          title={unitsFor.name}
          description="Physical units, each with an individual identity."
          onClose={() => setUnitsFor(null)}
        >
          <UnitList product={unitsFor} />
        </Modal>
      )}
    </>
  );
}
function UnitList({ product }: { product: Product }) {
  const units = useData<Unit[]>("/units");
  const [history, setHistory] = useState<Unit | null>(null);
  const list = units.data?.filter((unit) => unit.productId === product.id) || [];
  return units.loading ? (
    <Loading />
  ) : units.error ? (
    <ErrorState error={units.error} />
  ) : list.length ? (
    <div className="unit-list">
      {list.map((unit) => (
        <div key={unit.id}>
          <span>
            <strong>{unit.staffCode}</strong>
            <small className="mono">{unit.id}</small>
          </span>
          <Status value={unit.status} />
          <button
            className="icon-button"
            aria-label={`History of ${unit.staffCode}`}
            onClick={() => setHistory(unit)}
          >
            <History size={15} />
          </button>
          <Link
            className="icon-button"
            to={`/u/${unit.id}`}
            aria-label={`Open unit ${unit.staffCode}`}
          >
            <ArrowUpRight size={17} />
          </Link>
        </div>
      ))}
      {history && <UnitHistory unit={history} onClose={() => setHistory(null)} />}
    </div>
  ) : (
    <Empty
      title="No units yet"
      detail="Receive physical units for this product to create NFC identities."
    />
  );
}
export function Tags() {
  const [encoding, setEncoding] = useState<Unit | null>(null);
  const units = useData<Unit[]>("/units");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Unit | null>(null);
  const navigate = useNavigate();
  const [status, setStatus] = useState("AVAILABLE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const notify = useNotify();
  const list = (units.data || []).filter(
    (unit) =>
      `${unit.staffCode} ${unit.sku} ${unit.name}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === "all" || unit.status === status),
  );
  const allSelected = !!list.length && list.every((unit) => selected.has(unit.id));
  function toggleAll() {
    setSelected((previous) => {
      const next = new Set(previous);
      list.forEach((unit) => {
        if (allSelected) next.delete(unit.id);
        else next.add(unit.id);
      });
      return next;
    });
  }
  function exportTags() {
    const rows = (units.data || []).filter((unit) => selected.has(unit.id));
    downloadCSV("tapcart-nfc-manifest.csv", [
      ["unitId", "staffCode", "sku", "product", "ndefUri", "status"],
      ...rows.map((unit) => [
        unit.id,
        unit.staffCode,
        unit.sku,
        unit.name,
        `${window.location.origin}/u/${unit.id}`,
        unit.status,
      ]),
    ]);
    remember();
    notify(`${rows.length} NFC tag links exported.`);
  }
  function remember() {
    try {
      localStorage.setItem("tapcart.tags-exported", "1");
    } catch {
      // The setup checklist simply keeps this step open when storage is blocked.
    }
  }
  function printLabels() {
    remember();
    try {
      sessionStorage.setItem("tapcart.labels", JSON.stringify([...selected]));
    } catch {
      notify("Your browser blocked label storage. Export the manifest instead.");
      return;
    }
    navigate("/labels");
  }
  return (
    <>
      <PageTitle
        title="Tag studio"
        description="Select units, export links for your NFC encoder, or print QR labels. Read each tag back before attaching it."
        actions={
          <>
            <Button variant="secondary" disabled={!selected.size} onClick={printLabels}>
              <Printer size={15} />
              Print QR labels
            </Button>
            <Button disabled={!selected.size} onClick={exportTags}>
              <Download size={15} />
              Export manifest{selected.size > 0 && ` (${selected.size})`}
            </Button>
          </>
        }
      />
      <Panel>
        <div className="inventory-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search unit tags"
              placeholder="Search product, SKU or staff code…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select
            aria-label="Filter unit status"
            value={status}
            onValueChange={(value) => setStatus(value)}
          >
            <option value="AVAILABLE">Available units</option>
            <option value="RESERVED">Reserved units</option>
            <option value="SOLD">Sold units</option>
            <option value="all">All units</option>
          </Select>
          <span className="muted">{selected.size} selected</span>
        </div>
        {units.loading && !units.data ? (
          <Loading />
        ) : units.error ? (
          <ErrorState error={units.error} retry={units.reload} />
        ) : list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all visible units"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Physical unit</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>NFC link</th>
                </tr>
              </thead>
              <tbody>
                {list.map((unit) => (
                  <tr key={unit.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${unit.staffCode}`}
                        checked={selected.has(unit.id)}
                        onChange={() =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (next.has(unit.id)) next.delete(unit.id);
                            else next.add(unit.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <strong>{unit.staffCode}</strong>
                      <small className="mono">{unit.id.slice(0, 18)}…</small>
                    </td>
                    <td>
                      {unit.name}
                      <small>{unit.sku}</small>
                    </td>
                    <td>
                      <Status value={unit.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${window.location.origin}/u/${unit.id}`,
                              );
                              notify("Unit link copied.");
                            } catch {
                              notify(
                                "Clipboard unavailable. Open the link and copy it from the address bar.",
                              );
                            }
                          }}
                        >
                          <Copy size={14} />
                          Copy link
                        </button>
                        <Button variant="ghost" onClick={() => setEncoding(unit)}>
                          Encode & measure
                        </Button>
                        <button
                          className="icon-button"
                          aria-label={`History of ${unit.staffCode}`}
                          onClick={() => setHistory(unit)}
                        >
                          <History size={15} />
                        </button>
                        <Link
                          className="icon-button"
                          to={`/u/${unit.id}`}
                          aria-label={`Open NFC link for ${unit.staffCode}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No units to show"
            detail="Receive units in Inventory or select another status."
          />
        )}
        <div className="table-footer">
          <span>{list.length} physical units</span>
          <button
            className="text-button"
            onClick={() => setSelected(new Set())}
            disabled={!selected.size}
          >
            Clear selection
          </button>
        </div>
      </Panel>
      <p className="quiet-note">
        Static NFC tags identify an inventory record. They do not prove a product is genuine, so use
        physical checks and tamper-evident labels.
      </p>
      {encoding && (
        <Modal
          title={`Encode ${encoding.staffCode}`}
          description={encoding.name}
          className="nfc-dialog"
          onClose={() => setEncoding(null)}
        >
          <NfcTools unitId={encoding.id} />
        </Modal>
      )}
      {history && <UnitHistory unit={history} onClose={() => setHistory(null)} />}
    </>
  );
}
export function UnitHistory({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const history = useData<{
    createdAt: string;
    events: {
      id: string;
      eventType: string;
      createdAt: string;
      payload: Record<string, unknown>;
    }[];
  }>(`/units/${unit.id}/history`);
  return (
    <Modal title={unit.staffCode} description={unit.name} onClose={onClose}>
      <div className="detail-status">
        <Status value={unit.status} />
        <span>
          Version {unit.version} · Sale epoch {unit.saleEpoch}
        </span>
      </div>
      {history.loading ? (
        <Loading rows={3} />
      ) : history.error ? (
        <ErrorState error={history.error} retry={history.reload} />
      ) : (
        <ol className="timeline">
          {history.data?.events.map((row) => (
            <li key={row.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{eventLabel(row)}</strong>
                <small>{dateTime(row.createdAt)}</small>
              </div>
            </li>
          ))}
          <li>
            <span aria-hidden="true" />
            <div>
              <strong>Unit received</strong>
              <small>{history.data && dateTime(history.data.createdAt)}</small>
            </div>
          </li>
        </ol>
      )}
    </Modal>
  );
}
/** Printable sheet of QR labels. QR is the fallback carrier for phones or tags without NFC. */
export function Labels() {
  const units = useData<Unit[]>("/units");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [ids] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("tapcart.labels") || "[]") as string[];
    } catch {
      return [];
    }
  });
  const rows = (units.data || []).filter((unit) => ids.includes(unit.id));
  useEffect(() => {
    let active = true;
    if (!units.data) return;
    Promise.all(
      units.data
        .filter((unit) => ids.includes(unit.id))
        .map(
          async (unit) =>
            [
              unit.id,
              await QRCode.toDataURL(`${window.location.origin}/u/${unit.id}`, {
                errorCorrectionLevel: "M",
                margin: 0,
                width: 240,
              }),
            ] as const,
        ),
    ).then((entries) => {
      if (active) setCodes(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [units.data, ids]);
  return (
    <div className="labels-page">
      <header className="labels-head">
        <Link to="/store/tags" className="text-button">
          Back to Tag studio
        </Link>
        <span>{rows.length} labels</span>
        <Button onClick={() => window.print()} disabled={!rows.length}>
          <Printer size={15} />
          Print
        </Button>
      </header>
      {units.loading ? (
        <Loading />
      ) : units.error ? (
        <ErrorState error={units.error} retry={units.reload} />
      ) : rows.length ? (
        <div className="label-sheet">
          {rows.map((unit) => (
            <article className="label" key={unit.id}>
              {codes[unit.id] && <img src={codes[unit.id]} alt={`QR code for ${unit.staffCode}`} />}
              <div>
                <strong>{unit.name}</strong>
                <span>{money(unit.priceCents)}</span>
                <code>{unit.staffCode}</code>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No labels selected" detail="Choose units in Tag studio first." />
      )}
    </div>
  );
}
