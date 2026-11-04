import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Package,
  Pencil,
  Plus,
  Radio,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  downloadCSV,
  message,
  money,
  parseCSV,
  useData,
  write,
  type Product,
  type Unit,
} from "./api";
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
export function Inventory() {
  const products = useData<Product[]>("/products");
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState("all");
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
          ? product.available > 0 && product.available < 5
          : stock === "out"
            ? product.available === 0
            : product.available >= 5)),
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
        eyebrow="YOUR SHELVES, CONNECTED"
        title="A place for every product."
        description="Keep your catalog organized and your shelves ready for what’s next."
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
      <div className="summary-strip">
        <div>
          <Package size={20} />
          <strong>{list.length}</strong>
          <span>Products</span>
        </div>
        <div>
          <Radio size={20} />
          <strong>{list.reduce((sum, product) => sum + product.available, 0)}</strong>
          <span>Available units</span>
        </div>
        <div>
          <span className="stock-dot" />
          <strong>{list.filter((product) => product.available < 5).length}</strong>
          <span>Need a stock check</span>
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
          <select
            aria-label="Filter category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Filter stock"
            value={stock}
            onChange={(event) => setStock(event.target.value)}
          >
            <option value="all">All stock levels</option>
            <option value="available">Healthy stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <Button variant="secondary" onClick={exportProducts} disabled={!filtered.length}>
            <Download size={15} />
            Export
          </Button>
        </div>
        {products.loading ? (
          <Loading />
        ) : products.error ? (
          <ErrorState error={products.error} retry={products.reload} />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Available</th>
                  <th>Reserved</th>
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
                      <span className="muted"> units</span>
                    </td>
                    <td>{product.reserved}</td>
                    <td>
                      <Status
                        value={
                          product.available === 0
                            ? "OUT_OF_STOCK"
                            : product.available < 5
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
            title={list.length ? "No products found" : "Every great store starts somewhere."}
            detail={
              list.length
                ? "Try a different search or stock filter."
                : "Add your first product, then connect every physical unit."
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
      <div className="quiet-note">
        <Radio size={16} />
        <p>
          Every physical unit has its own identity.{" "}
          <Link to="/store/tags">
            Connect your products in Tag studio <ArrowRight size={13} />
          </Link>
        </p>
      </div>
      {editing && (
        <Modal
          title={editing === "new" ? "Make room for something new." : "A little product refresh."}
          description="Your product details live here. Each physical unit gets its own NFC identity."
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
                  placeholder="e.g. Everyday ceramic mug"
                />
              </label>
              <label>
                SKU
                <input
                  name="sku"
                  required
                  maxLength={80}
                  defaultValue={editing === "new" ? "" : editing.sku}
                  placeholder="e.g. HOME-001"
                />
              </label>
              <label>
                Category
                <input
                  name="category"
                  aria-label="Category"
                  required
                  maxLength={80}
                  defaultValue={editing === "new" ? "" : editing.category}
                  placeholder="e.g. Home & living"
                  list="category-options"
                />
                <datalist id="category-options">
                  {categories.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </datalist>
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
        <Modal
          title="A fresh arrival."
          description={`Receive new physical units of ${receiving.name}.`}
          onClose={close}
        >
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
          <Link
            className="icon-button"
            to={`/u/${unit.id}`}
            aria-label={`Open unit ${unit.staffCode}`}
          >
            <ArrowUpRight size={17} />
          </Link>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      title="Ready to receive"
      detail="Receive physical units for this product to create NFC identities."
    />
  );
}
export function Tags() {
  const units = useData<Unit[]>("/units");
  const [query, setQuery] = useState("");
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
    notify(`${rows.length} NFC tag links exported.`);
  }
  return (
    <>
      <PageTitle
        eyebrow="SMALL TAGS. BIG POSSIBILITIES."
        title="Bring your products to life."
        description="Give every physical item its own link. One tap starts the connection."
        actions={
          <Button disabled={!selected.size} onClick={exportTags}>
            <Download size={16} />
            Export manifest{selected.size > 0 && ` (${selected.size})`}
          </Button>
        }
      />
      <div className="tag-guide">
        <span className="tag-guide-icon">
          <Radio size={34} strokeWidth={1.4} />
        </span>
        <div>
          <h2>A unique identity. For every single item.</h2>
          <p>
            Select physical units, export their links and write each HTTPS URI to its own NFC tag.
            Read back each tag before attaching it.
          </p>
        </div>
        <span className="guide-badge">
          <ShieldCheckIcon />
          Serialized by design
        </span>
      </div>
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
          <select
            aria-label="Filter unit status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="AVAILABLE">Available units</option>
            <option value="RESERVED">Reserved units</option>
            <option value="SOLD">Sold units</option>
            <option value="all">All units</option>
          </select>
          <span className="muted">{selected.size} selected</span>
        </div>
        {units.loading ? (
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
      <div className="quiet-note">
        <Radio size={16} />
        <p>
          Static NFC tags identify an inventory record. Use physical product checks and
          tamper-evident labels when provisioning.
        </p>
      </div>
    </>
  );
}
function ShieldCheckIcon() {
  return <Check size={14} />;
}
