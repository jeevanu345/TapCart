import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  CornerDownLeft,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorCheck,
  Package,
  Radio,
  Search,
  Settings as SettingsIcon,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  message,
  shortId,
  useData,
  write,
  type AppNotification,
  type Customer,
  type Order,
  type Product,
} from "./api";
import { useAuth } from "./App";
import { Logo, Modal, ThemeToggle, useNotify, usePopover } from "./ui";
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
const storeNav: { label: string; items: NavItem[] }[] = [
  {
    label: "Run",
    items: [
      { to: "/store/overview", label: "Overview", icon: LayoutDashboard },
      { to: "/store/desk", label: "Desk", icon: MonitorCheck },
      { to: "/store/orders", label: "Orders", icon: ShoppingBag },
    ],
  },
  {
    label: "Stock",
    items: [
      { to: "/store/inventory", label: "Inventory", icon: Package },
      { to: "/store/tags", label: "Tag studio", icon: Radio },
    ],
  },
  {
    label: "Understand",
    items: [
      { to: "/store/reports", label: "Reports", icon: BarChart3 },
      { to: "/store/customers", label: "Customers", icon: Users },
      { to: "/store/intelligence", label: "Intelligence", icon: Sparkles },
      { to: "/store/activity", label: "Activity", icon: ActivityIcon },
    ],
  },
];
const adminNav: { label: string; items: NavItem[] }[] = [
  {
    label: "Platform",
    items: [
      { to: "/admin", label: "Stores", icon: LayoutDashboard },
      { to: "/admin/users", label: "Accounts", icon: Users },
      { to: "/admin/activity", label: "Activity", icon: ActivityIcon },
    ],
  },
];
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export function Shell({ admin = false }: { admin?: boolean }) {
  const { refresh } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => stored("tapcart.sidebar") === "collapsed");
  const groups = admin ? adminNav : storeNav;
  const flat = groups.flatMap((group) => group.items);
  const settingsPath = admin ? "/admin/settings" : "/store/settings";
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  function collapse() {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem("tapcart.sidebar", collapsed ? "open" : "collapsed");
    } catch {
      // Preference only lasts for this page when storage is blocked.
    }
  }
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
  const nav = (mini: boolean) => (
    <>
      <Link to={admin ? "/admin" : "/store/overview"} className="brand-link" aria-label="TapCart">
        <Logo compact={mini} />
      </Link>
      <nav aria-label="Main navigation" className="side-nav">
        {groups.map((group) => (
          <div key={group.label} className="nav-group">
            {!mini && <p className="nav-label">{group.label}</p>}
            {group.items.map((item) => (
              <NavLink
                end={item.to === "/admin"}
                to={item.to}
                key={item.to}
                title={mini ? item.label : undefined}
                aria-label={mini ? item.label : undefined}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <item.icon size={17} strokeWidth={1.75} />
                {!mini && item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <NavLink
          to={settingsPath}
          title={mini ? "Settings" : undefined}
          aria-label={mini ? "Settings" : undefined}
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <SettingsIcon size={17} strokeWidth={1.75} />
          {!mini && "Settings"}
        </NavLink>
        <button
          className="nav-item"
          onClick={() => setHelp(true)}
          aria-label={mini ? "Getting started" : undefined}
          title={mini ? "Getting started" : undefined}
        >
          <CircleHelp size={17} strokeWidth={1.75} />
          {!mini && "Getting started"}
        </button>
        <Link
          className="nav-item"
          to="/customer"
          aria-label={mini ? "Shopper view" : undefined}
          title={mini ? "Shopper view" : undefined}
        >
          <ShoppingCart size={17} strokeWidth={1.75} />
          {!mini && (
            <>
              Shopper view
              <ArrowUpRight size={13} className="nav-end" />
            </>
          )}
        </Link>
      </div>
    </>
  );
  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        {nav(collapsed)}
        <button
          className="collapse-toggle icon-button"
          onClick={collapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </aside>
      {open && (
        <Modal title="Navigation" onClose={() => setOpen(false)} className="drawer">
          <div className="mobile-nav">{nav(false)}</div>
        </Modal>
      )}
      <div className="workspace-body">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu size={19} />
          </button>
          <strong className="topbar-title">
            {flat.find((link) => location.pathname.startsWith(link.to) && link.to !== "/admin")
              ?.label ||
              (location.pathname.endsWith("settings") ? "Settings" : admin ? "Stores" : "Overview")}
          </strong>
          <div className="topbar-right">
            <button className="palette-trigger" onClick={() => setPalette(true)}>
              <Search size={14} />
              <span>Search or jump to</span>
              <kbd>⌘K</kbd>
            </button>
            <NotificationBell />
            <ThemeToggle />
            <UserMenu onLogout={logout} settingsPath={settingsPath} />
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-enter" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      {palette && (
        <CommandPalette
          admin={admin}
          nav={flat}
          settingsPath={settingsPath}
          onClose={() => setPalette(false)}
          onLogout={logout}
        />
      )}
      {help && (
        <Modal
          title="Getting started"
          description="From an empty shelf to a shopper's first tap."
          onClose={() => setHelp(false)}
        >
          <ol className="help-steps">
            <li>
              <strong>Build your catalog</strong>
              Add products in Inventory, then receive the physical units on your shelf.
            </li>
            <li>
              <strong>Tag each unit</strong>
              Export a manifest or print QR labels from Tag studio. Write each unit's link to its
              own NFC tag and read it back before attaching it.
            </li>
            <li>
              <strong>Let shoppers tap</strong>A tap opens the unit link. The shopper signs in,
              reserves that exact item and checks out. Desk payments wait for you in Desk.
            </li>
            <li>
              <strong>Decide with evidence</strong>
              Reports and Intelligence read your actual sales. They never change stock or payments.
            </li>
          </ol>
        </Modal>
      )}
    </div>
  );
}
function NotificationBell() {
  const { data, reload } = useData<AppNotification[]>("/notifications");
  const { open, setOpen, ref } = usePopover();
  useEffect(() => {
    const interval = setInterval(reload, 30000);
    return () => clearInterval(interval);
  }, [reload]);
  const items = data || [];
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="icon-button bell"
        aria-label={`Notifications, ${items.length} open`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={17} />
        {items.length > 0 && <span className="bell-dot" />}
      </button>
      {open && (
        <div className="popover">
          <p className="popover-title">Needs attention</p>
          {items.length ? (
            items.map((item) => (
              <Link key={item.id} to={item.href} onClick={() => setOpen(false)}>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </Link>
            ))
          ) : (
            <p className="popover-empty">Nothing is waiting on you.</p>
          )}
        </div>
      )}
    </div>
  );
}
function UserMenu({ onLogout, settingsPath }: { onLogout: () => void; settingsPath: string }) {
  const { user } = useAuth();
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="avatar small avatar-button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {user?.name.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div className="popover">
          <p className="popover-account">
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </p>
          <Link to={settingsPath} onClick={() => setOpen(false)}>
            <strong>Settings</strong>
          </Link>
          <button onClick={onLogout}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
function CommandPalette({
  admin,
  nav,
  settingsPath,
  onClose,
  onLogout,
}: {
  admin: boolean;
  nav: NavItem[];
  settingsPath: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const products = useData<Product[]>(admin ? null : "/products");
  const orders = useData<Order[]>(admin ? null : "/orders");
  const customers = useData<Customer[]>(admin ? null : "/customers");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const q = query.trim().toLowerCase();
    const commands = [
      ...nav.map((item) => ({ group: "Go to", label: item.label, hint: "", run: go(item.to) })),
      { group: "Go to", label: "Settings", hint: "", run: go(settingsPath) },
      ...(admin
        ? []
        : [
            {
              group: "Actions",
              label: "Add product",
              hint: "",
              run: go("/store/inventory?add=1"),
            },
            {
              group: "Actions",
              label: "Invite a teammate",
              hint: "",
              run: go("/store/settings?tab=team"),
            },
          ]),
      { group: "Actions", label: "Sign out", hint: "", run: onLogout },
    ];
    const records = q
      ? [
          ...(products.data || []).map((row) => ({
            group: "Products",
            label: row.name,
            hint: row.sku,
            run: go(`/store/inventory?q=${encodeURIComponent(row.sku)}`),
          })),
          ...(orders.data || []).map((row) => ({
            group: "Orders",
            label: shortId(row.id),
            hint: row.customerName,
            run: go(`/store/orders?order=${row.id}`),
          })),
          ...(customers.data || []).map((row) => ({
            group: "Customers",
            label: row.name,
            hint: row.email,
            run: go(`/store/customers?q=${encodeURIComponent(row.email)}`),
          })),
        ]
      : [];
    return [...commands, ...records]
      .filter((row) => `${row.label} ${row.hint}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [
    query,
    products.data,
    orders.data,
    customers.data,
    nav,
    admin,
    settingsPath,
    navigate,
    onClose,
    onLogout,
  ]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="palette" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Search or jump to</Dialog.Title>
          <div className="palette-input">
            <Search size={16} />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-label="Search products, orders, customers or actions"
              placeholder="Search products, orders, customers or actions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((value) => Math.min(value + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((value) => Math.max(value - 1, 0));
                } else if (event.key === "Enter") results[active]?.run();
              }}
            />
          </div>
          <div className="palette-list" id="palette-list" role="listbox" ref={list}>
            {results.length ? (
              results.map((row, index) => (
                <button
                  key={`${row.group}-${row.label}-${row.hint}`}
                  role="option"
                  aria-selected={index === active}
                  onPointerMove={() => setActive(index)}
                  onClick={row.run}
                >
                  <small>{row.group}</small>
                  <span>{row.label}</span>
                  {row.hint && <em>{row.hint}</em>}
                  {index === active && <CornerDownLeft size={13} />}
                </button>
              ))
            ) : (
              <p className="popover-empty">No results for “{query}”.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
