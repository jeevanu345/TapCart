import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  LoaderCircle,
  Moon,
  Package,
  Sun,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
/** The TapCart mark: three points joined by dotted lines. `alive` marches the dots. */
export function LogoMark({ size = 22, alive = false }: { size?: number; alive?: boolean }) {
  return (
    <svg
      className={`logo-mark ${alive ? "alive" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path className="logo-line" d="M16 6 4.5 26h23Z" />
      <circle cx="16" cy="6" r="3.6" />
      <circle cx="4.5" cy="26" r="3.6" />
      <circle cx="27.5" cy="26" r="3.6" />
    </svg>
  );
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <LogoMark />
      {!compact && <span className="logo-word">TapCart</span>}
    </span>
  );
}
export function Button({
  children,
  variant = "primary",
  className = "",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`button ${variant} ${className}`}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
const statusTone: Record<string, string> = {
  completed: "done",
  paid: "done",
  approved: "done",
  available: "done",
  in_stock: "done",
  refunded: "muted",
  sold: "muted",
  high: "done",
  medium: "open",
  low: "muted",
  owner: "done",
  admin: "done",
  store: "open",
  customer: "muted",
  manager: "open",
  staff: "muted",
  payment_pending: "open",
  reserved: "open",
  pending: "open",
  low_stock: "open",
  refund_pending: "alert",
  payment_failed: "alert",
  denied: "alert",
  out_of_stock: "alert",
};
/** Monochrome status: the dot's shape and the pill's fill carry meaning, never hue. */
export function Status({ value }: { value: string }) {
  const key = value.toLowerCase();
  return (
    <span className={`status ${statusTone[key] ?? "muted"}`}>
      <span aria-hidden="true" />
      {key.replaceAll("_", " ")}
    </span>
  );
}
export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title = "Nothing here yet",
  detail,
  children,
}: {
  title?: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <LogoMark size={26} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" role="status">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton" style={{ width: `${100 - index * 7}%` }} />
      ))}
    </div>
  );
}
export function Startup() {
  return (
    <div className="startup" role="status">
      <LogoMark size={40} alive />
      <span className="sr-only">Loading TapCart</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      <span>{error}</span>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${className}`}
          onOpenAutoFocus={(event) => {
            const field = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
              "form input:not([readonly], [type=hidden]), form button[role=combobox], form select:not([aria-hidden=true]), form textarea",
            );
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && <Dialog.Description>{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ProductArt({
  name,
  imageUrl,
  small = false,
}: {
  category?: string;
  name: string;
  imageUrl?: string;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`product-art ${small ? "small" : ""}`}>
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt={small ? "" : name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package strokeWidth={1.3} size={small ? 18 : 32} />
      )}
    </span>
  );
}
export function ArrowLink({ children }: { children: ReactNode }) {
  return (
    <span className="arrow-link">
      {children}
      <ArrowUpRight size={14} />
    </span>
  );
}
/** Counts up once when a figure first appears. Reduced motion shows the final value. */
export function CountUp({
  value,
  format,
  step = 1,
}: {
  value: number;
  format?: (n: number) => string;
  step?: number;
}) {
  const [shown, setShown] = useState(value);
  const previous = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || previous.current === value) {
      setShown(value);
      previous.current = value;
      return;
    }
    const from = previous.current,
      start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      setShown(from + (value - from) * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  // Whole rupees while moving, so paise never flicker; the final frame is the exact value.
  const rounded = shown === value ? value : Math.round(shown / step) * step;
  return <>{format ? format(rounded) : rounded.toLocaleString("en-IN")}</>;
}
type Theme = "light" | "dark";
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || "light",
  );
  const toggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      const apply = () => {
        document.documentElement.dataset.theme = next;
        setTheme(next);
        try {
          localStorage.setItem("tapcart.theme", next);
        } catch {
          // Private windows may block storage; the theme still applies for this page.
        }
      };
      const doc = document as Document & {
        startViewTransition?: (update: () => void) => { ready: Promise<void> };
      };
      if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        apply();
        return;
      }
      const { clientX: x, clientY: y } = event;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      doc.startViewTransition(apply).ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: 420,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      });
    },
    [theme],
  );
  return (
    <button
      className="icon-button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to white theme" : "Switch to black theme"}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
/** Closes on outside press or Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}
const NotifyContext = createContext<(text: string) => void>(() => undefined);
export function Notifications({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    setNotice({ text, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {notice && (
        <div className="notification" role="status" key={notice.id}>
          <Check size={16} />
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </NotifyContext.Provider>
  );
}
export const useNotify = () => useContext(NotifyContext);
