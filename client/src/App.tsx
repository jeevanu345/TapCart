import { createContext, lazy, Suspense, useContext, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { message, session, useData, write, type Session, type Store, type User } from "./api";
import { Button, ErrorState, Loading, Logo, Startup, useNotify } from "./ui";
const pick = <M, K extends keyof M>(load: () => Promise<M>, key: K) =>
  lazy(() =>
    load().then((module) => ({ default: module[key] as unknown as React.ComponentType<object> })),
  ) as unknown as M[K];
const ops = () => import("./operations");
const inv = () => import("./inventory");
const ord = () => import("./orders");
const shop = () => import("./shopper");
const sett = () => import("./settings");
const rep = () => import("./reports");
const Landing = pick(() => import("./landing"), "Landing");
const AuthPage = pick(() => import("./auth"), "AuthPage");
const Shell = pick(() => import("./shell"), "Shell");
const Overview = pick(ops, "Overview");
const Customers = pick(ops, "Customers");
const Intelligence = pick(ops, "Intelligence");
const Admin = pick(ops, "Admin");
const Inventory = pick(inv, "Inventory");
const Tags = pick(inv, "Tags");
const Labels = pick(inv, "Labels");
const Orders = pick(ord, "Orders");
const Desk = pick(ord, "Desk");
const Receipt = pick(ord, "Receipt");
const Shopper = pick(shop, "Shopper");
const Scan = pick(shop, "Scan");
const Settings = pick(sett, "Settings");
const AcceptInvite = pick(sett, "AcceptInvite");
const Reports = pick(rep, "Reports");
const Activity = pick(rep, "Activity");
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
  if (!auth) return <Startup />;
  return (
    <AuthContext.Provider value={{ user: auth.user, refresh }}>
      <Suspense fallback={<Startup />}>
        <Routes>
          <Route
            path="/"
            element={auth.user ? <Navigate to={homeFor(auth.user)} replace /> : <Landing />}
          />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/store/login" element={<AuthPage />} />
          <Route path="/admin/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/store/signup" element={<AuthPage register />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/customer" element={<Shopper />} />
          <Route path="/u/:id" element={<Scan />} />
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route
            path="/labels"
            element={
              <RequireStaff>
                <Labels />
              </RequireStaff>
            }
          />
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
            <Route path="desk" element={<Desk />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="products" element={<Navigate to="/store/inventory" replace />} />
            <Route path="all-products" element={<Navigate to="/store/inventory" replace />} />
            <Route path="orders" element={<Orders />} />
            <Route path="sales" element={<Orders />} />
            <Route path="purchases" element={<Orders />} />
            <Route path="customers" element={<Customers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="activity" element={<Activity />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="tags" element={<Tags />} />
            <Route path="export" element={<Navigate to="/store/tags" replace />} />
            <Route path="settings" element={<Settings />} />
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
            <Route path="activity" element={<Activity />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="startup">
                <Logo />
                <h1>This page does not exist.</h1>
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
    if (membership.loading && !membership.data) return <Loading />;
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
        <h1>
          {store.status === "PENDING" ? `${store.name} is in review` : "Store access is paused"}
        </h1>
        <p>
          {store.status === "PENDING"
            ? "An administrator reviews every new store. Your workspace opens as soon as it is approved."
            : "An administrator paused this workspace. Contact them to review your account."}
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
