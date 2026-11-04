import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, Package, Radio, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Radio size={23} strokeWidth={2.1} />
      </span>
      {!compact && (
        <>
          tapcart<span className="logo-dot">.</span>
        </>
      )}
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
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.toLowerCase().replaceAll("_", "-")}`}>
      <span />
      {value.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
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
            <h2>{title}</h2>
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
  detail = "Your activity will appear here.",
  children,
}: {
  title?: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Package size={25} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Getting the latest from your store…
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={19} />
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
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
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
        <Dialog.Content className="modal">
          <div className="modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ?? "Complete the details below."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ProductArt({
  category,
  name,
  imageUrl,
  small = false,
}: {
  category: string;
  name: string;
  imageUrl?: string;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`product-art ${small ? "small" : ""}`} data-category={category.toLowerCase()}>
      {imageUrl && !failed ? (
        <img src={imageUrl} alt={name} onError={() => setFailed(true)} />
      ) : (
        <Package strokeWidth={1.4} size={small ? 20 : 35} />
      )}
    </span>
  );
}
export function ArrowLink({ children }: { children: ReactNode }) {
  return (
    <span className="arrow-link">
      {children}
      <ArrowUpRight size={15} />
    </span>
  );
}
const NotifyContext = createContext<(text: string) => void>(() => undefined);
export function Notifications({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function notify(text: string) {
    setNotice(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), 5000);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {notice && (
        <div className="notification" role="status">
          <Check size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </NotifyContext.Provider>
  );
}
export const useNotify = () => useContext(NotifyContext);
