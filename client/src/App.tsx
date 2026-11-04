import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Radio,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store as StoreIcon,
  Users,
} from "lucide-react";
import { message, session, useData, write, type Session, type Store, type User } from "./api";
import { Button, ErrorState, Loading, Logo, Modal, useNotify } from "./ui";
const Overview = lazy(() =>
  import("./operations").then((module) => ({ default: module.Overview })),
);
const Customers = lazy(() =>
  import("./operations").then((module) => ({ default: module.Customers })),
);
const Intelligence = lazy(() =>
  import("./operations").then((module) => ({ default: module.Intelligence })),
);
const Admin = lazy(() => import("./operations").then((module) => ({ default: module.Admin })));
const Inventory = lazy(() =>
  import("./inventory").then((module) => ({ default: module.Inventory })),
);
const Tags = lazy(() => import("./inventory").then((module) => ({ default: module.Tags })));
const Orders = lazy(() => import("./orders").then((module) => ({ default: module.Orders })));
const Receipt = lazy(() => import("./orders").then((module) => ({ default: module.Receipt })));
const Shopper = lazy(() => import("./shopper").then((module) => ({ default: module.Shopper })));
const Scan = lazy(() => import("./shopper").then((module) => ({ default: module.Scan })));
interface AuthContextValue {
  user: User | null;
  refresh: () => Promise<Session>;
}
const AuthContext = createContext<AuthContextValue>({ user: null, refresh: session });
export const useAuth = () => useContext(AuthContext);
export function App() {
  const [auth, setAuth] = useState<Session | null>(null);
  const [error, setError] = useState("");
  async function refresh() {
    const result = await session();
    setAuth(result);
    return result;
  }
  useEffect(() => {
    refresh().catch((e: unknown) => setError(message(e)));
  }, []);
  if (error)
    return (
      <div className="startup">
        <Logo />
        <ErrorState
          error={error}
          retry={() => {
            setError("");
            refresh().catch((e: unknown) => setError(message(e)));
          }}
        />
      </div>
    );
  if (!auth)
    return (
      <div className="startup">
        <Logo />
        <Loading />
      </div>
    );
  return (
    <AuthContext.Provider value={{ user: auth.user, refresh }}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route
            path="/"
            element={auth.user ? <Navigate to={homeFor(auth.user)} replace /> : <AuthPage />}
          />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/store/login" element={<AuthPage />} />
          <Route path="/admin/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/store/signup" element={<AuthPage register />} />
          <Route path="/customer" element={<Shopper />} />
          <Route path="/u/:id" element={<Scan />} />
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route
            path="/store"
            element={
              <RequireStaff>
                <Shell />
              </RequireStaff>
            }
          >
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<Overview />} />
            <Route path="dashboard" element={<Navigate to="/store/overview" replace />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="products" element={<Navigate to="/store/inventory" replace />} />
            <Route path="all-products" element={<Navigate to="/store/inventory" replace />} />
            <Route path="orders" element={<Orders />} />
            <Route path="sales" element={<Orders />} />
            <Route path="purchases" element={<Orders />} />
            <Route path="customers" element={<Customers />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="tags" element={<Tags />} />
            <Route path="export" element={<Navigate to="/store/tags" replace />} />
          </Route>
          <Route
            path="/admin"
            element={
              <RequireStaff admin>
                <Shell admin />
              </RequireStaff>
            }
          >
            <Route index element={<Admin />} />
            <Route path="dashboard" element={<Admin />} />
            <Route path="users" element={<Admin users />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="startup">
                <Logo />
                <h1>This page has moved.</h1>
                <Link className="button primary" to="/">
                  Back to TapCart <ArrowRight size={16} />
                </Link>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </AuthContext.Provider>
  );
}
export const homeFor = (user: User) =>
  user.role === "ADMIN" ? "/admin" : user.role === "STORE" ? "/store/overview" : "/customer";
function RequireStaff({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  const membership = useData<Store[]>(user?.role === "STORE" ? "/stores" : null);
  if (!user)
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role === "CUSTOMER" || (admin && user.role !== "ADMIN"))
    return <Navigate to={homeFor(user)} replace />;
  if (user.role === "STORE") {
    if (membership.loading) return <Loading />;
    if (membership.error)
      return (
        <div className="startup">
          <Logo />
          <ErrorState error={membership.error} retry={membership.reload} />
        </div>
      );
    const store = membership.data?.find((value) => value.id === user.storeId);
    if (store && store.status !== "APPROVED")
      return <PendingStore store={store} reload={membership.reload} />;
  }
  return children;
}
function PendingStore({ store, reload }: { store: Store; reload: () => void }) {
  const { refresh } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  return (
    <div className="startup">
      <Logo />
      <div className="pending-store panel">
        <span className="empty-icon">
          <ShieldCheck size={26} />
        </span>
        <span className="eyebrow">{store.name}</span>
        <h1>
          {store.status === "PENDING"
            ? "A good beginning, in the making."
            : "Your store access is paused."}
        </h1>
        <p>
          {store.status === "PENDING"
            ? "Your store registration is waiting for administrator approval. Your workspace will be ready as soon as it’s approved."
            : "An administrator has paused access to your store workspace. Contact your platform administrator to review your account."}
        </p>
        <div className="actions">
          <Button onClick={reload}>
            Check status
            <ArrowRight size={16} />
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await write("/auth/logout", {});
                await refresh();
                navigate("/login");
              } catch (e) {
                notify(message(e));
              }
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function Shell({ admin = false }: { admin?: boolean }) {
  const { user, refresh } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState("");
  const links = admin
    ? [
        { to: "/admin", label: "Platform overview", icon: LayoutDashboard },
        { to: "/admin/users", label: "Store accounts", icon: Users },
      ]
    : [
        { to: "/store/overview", label: "Overview", icon: LayoutDashboard },
        { to: "/store/inventory", label: "Inventory", icon: Package },
        { to: "/store/orders", label: "Orders", icon: ShoppingBag },
        { to: "/store/customers", label: "Customers", icon: Users },
        { to: "/store/intelligence", label: "Intelligence", icon: Sparkles },
        { to: "/store/tags", label: "Tag studio", icon: Radio },
      ];
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  async function logout() {
    try {
      await write("/auth/logout", {});
      await refresh();
      navigate("/login");
      notify("You have been signed out.");
    } catch (e) {
      notify(message(e));
    }
  }
  const sidebar = (
    <>
      <Link to={admin ? "/admin" : "/store/overview"} className="brand-link">
        <Logo />
      </Link>
      <div className="workspace">
        <span className="workspace-icon">
          <StoreIcon size={18} />
        </span>
        <span>
          <strong>{admin ? "Platform administration" : user?.name || "Your workspace"}</strong>
          <small>{admin ? "Administrator" : "Store workspace"}</small>
        </span>
        <ChevronDown size={14} />
      </div>
      <p className="nav-label">{admin ? "ADMINISTRATION" : "WORKSPACE"}</p>
      <nav aria-label="Main navigation">
        {links.map((item) => (
          <NavLink
            end={item.to === "/admin"}
            to={item.to}
            key={item.to}
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <item.icon size={18} />
            {item.label}
            {item.label === "Intelligence" && <span className="new-pill">AI</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <span className="live-dot" />
          <span>Every unit. Connected.</span>
          <Radio size={16} />
        </div>
        <button className="nav-item" onClick={() => setHelp(true)}>
          <CircleHelp size={18} />
          Help & getting started
          <ArrowUpRight size={14} />
        </button>
        <Link className="nav-item" to="/customer">
          <ShoppingCart size={18} />
          Open shopper view
          <ArrowUpRight size={14} />
        </Link>
        <button className="user-card" onClick={logout}>
          <span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span>
          <span>
            <strong>{user?.name}</strong>
            <small>{user?.role.toLowerCase()} account</small>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">{sidebar}</aside>
      {open && (
        <Modal title="Workspace navigation" onClose={() => setOpen(false)}>
          <div className="mobile-nav">{sidebar}</div>
        </Modal>
      )}
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {links.find((link) => link.to === location.pathname)?.label || "Overview"}
            </strong>
          </div>
          <div className="topbar-right">
            {!admin && (
              <form
                className="global-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigate(`/store/inventory?q=${encodeURIComponent(search)}`);
                }}
              >
                <Search size={15} />
                <input
                  aria-label="Search your inventory"
                  placeholder="Search inventory…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd>↵</kbd>
              </form>
            )}
            <span className="live-indicator">
              <span className="live-dot" />
              Workspace ready
            </span>
            <span className="avatar small">{user?.name.slice(0, 2).toUpperCase()}</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>Thoughtful retail. Powered by TapCart.</span>
          <span>
            <span className="live-dot" />
            Store workspace
          </span>
        </footer>
      </div>
      {help && (
        <Modal
          title="A little help goes a long way"
          description="Your guide to connected retail."
          onClose={() => setHelp(false)}
        >
          <div className="help-steps">
            <p>
              <strong>01 · Build your catalog</strong>
              <br />
              Add products in Inventory, then receive the physical units you have on the shelf.
            </p>
            <p>
              <strong>02 · Connect each item</strong>
              <br />
              Export a manifest from Tag studio. Write each unit's HTTPS link to its own NFC tag,
              then read it back before attaching it.
            </p>
            <p>
              <strong>03 · Let shoppers tap</strong>
              <br />
              An NFC tap opens the unit link. Shoppers sign in, reserve the item and checkout. Desk
              payments appear in Orders for your review.
            </p>
            <p>
              <strong>04 · Make better decisions</strong>
              <br />
              Intelligence explains current inventory and sales data with links back to your next
              action.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AuthPage({ register = false }: { register?: boolean }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<"STORE" | "CUSTOMER">("STORE");
  const [show, setShow] = useState(false);
  const requested = new URLSearchParams(location.search).get("returnTo");
  const returnTo = requested?.startsWith("/") && !requested.startsWith("//") ? requested : null;
  if (user) return <Navigate to={returnTo || homeFor(user)} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (register)
        await write("/auth/register", {
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role,
          ...(role === "STORE"
            ? { storeName: form.get("storeName"), address: form.get("address") }
            : {}),
        });
      else await write("/auth/login", { email: form.get("email"), password: form.get("password") });
      const updated = await refresh();
      if (updated.user) navigate(returnTo || homeFor(updated.user));
      else
        setError(
          register
            ? "Registration received. Store accounts need administrator approval before signing in."
            : "Please sign in again.",
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Link to="/">
          <Logo />
        </Link>
        <div className="auth-story-content">
          <span className="eyebrow">A LITTLE TAP. A BIG DIFFERENCE.</span>
          <h1>
            A better day
            <br />
            in store.
          </h1>
          <p>
            Less time at checkout.
            <br />
            More room for what matters.
          </p>
          <div className="tap-illustration" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="paper-tag">
              <span className="tag-hole" />
              <Radio size={53} strokeWidth={1.2} />
              <span>
                ONE ITEM.
                <br />
                ENDLESS POSSIBILITY.
              </span>
              <span className="tag-barcode">▥▥▥▥▥▥</span>
            </div>
            <div className="tap-caption">
              <span className="live-dot" />
              Pick it. Tap it. Make it yours.
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>NFC shopping, beautifully connected.</span>
          <span>© {new Date().getFullYear()} TapCart</span>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <Link to="/customer">
            Explore shopper view <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">
            {register ? "MAKE YOURSELF AT HOME" : "YOUR NEXT CHAPTER IN RETAIL"}
          </span>
          <h2>{register ? "Welcome to the neighborhood." : "Good to have you back."}</h2>
          <p>
            {register
              ? "Create an account and connect with a better shopping experience."
              : "Sign in to see what’s happening in your store."}
          </p>
          <form onSubmit={submit} className="form-stack">
            {register && (
              <>
                <div className="segmented" aria-label="Account type">
                  <button
                    type="button"
                    aria-pressed={role === "STORE"}
                    onClick={() => setRole("STORE")}
                  >
                    I run a store
                  </button>
                  <button
                    type="button"
                    aria-pressed={role === "CUSTOMER"}
                    onClick={() => setRole("CUSTOMER")}
                  >
                    I’m a shopper
                  </button>
                </div>
                <label>
                  Your name
                  <input name="name" autoComplete="name" required placeholder="Alex Morgan" />
                </label>
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  aria-label="Password"
                  type={show ? "text" : "password"}
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 12 : undefined}
                  required
                  placeholder={register ? "At least 12 characters" : "Enter your password"}
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            {register && role === "STORE" && (
              <>
                <label>
                  Store name
                  <input name="storeName" required placeholder="Your neighborhood store" />
                </label>
                <label>
                  Store address
                  <input name="address" required placeholder="Street, city" />
                </label>
                <p className="form-hint">
                  Your store account will be reviewed by an administrator.
                </p>
              </>
            )}
            {error && <ErrorState error={error} />}
            <Button busy={busy} type="submit">
              {register ? "Create account" : "Sign in to your workspace"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="auth-switch">
            {register ? "Already part of the neighborhood?" : "New to TapCart?"}{" "}
            <Link
              to={`${register ? "/login" : "/register"}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
            >
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
          {import.meta.env.DEV && (
            <details className="demo-credentials">
              <summary>Development demo accounts</summary>
              <p>
                Store: <code>store@tapcart.local</code>
                <br />
                Shopper: <code>shopper@tapcart.local</code>
                <br />
                Admin: <code>admin@tapcart.local</code>
                <br />
                Password: <code>TapCartDemo123!</code>
              </p>
              <small>
                Seeded development data. Payments are simulated only when enabled on the server.
              </small>
            </details>
          )}
          <div className="auth-trust">
            <ShieldCheck size={15} />
            Your store, in safe hands.
          </div>
        </div>
        <div className="auth-bottom">Connected products. Happier people.</div>
      </section>
    </div>
  );
}
