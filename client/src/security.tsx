import { useAuth } from "./App";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, dateTime, message, session, useData, write, type Session } from "./api";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Logo,
  PageTitle,
  Panel,
  Status,
  ThemeToggle,
} from "./ui";
import "./security.css";
interface SecurityStatus {
  emailVerifiedAt: string | null;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
}
interface Delivery {
  mode: string;
  messages: {
    id: string;
    kind: string;
    subject: string;
    status: string;
    attempts: number;
    createdAt: string;
    lastError: string | null;
  }[];
}
export function SecurityPage({ staff = false }: { staff?: boolean }) {
  const { user } = useAuth();
  const canSeeDelivery =
    staff &&
    (user?.role === "ADMIN" ||
      (user?.role === "STORE" && ["OWNER", "MANAGER"].includes(user.storeRole ?? "")));
  const status = useData<SecurityStatus>("/auth/security"),
    delivery = useData<Delivery>(canSeeDelivery ? "/notifications/delivery" : null);
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrDataUrl: string } | null>(
      null,
    ),
    [codes, setCodes] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      status.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const content = (
    <div className="security-page">
      {status.loading ? (
        <Loading />
      ) : (
        <>
          <PageTitle
            title="Account security"
            description="Verify your email and protect your account with an authenticator."
          />
          {status.error && <ErrorState error={status.error} />}
          {error && <ErrorState error={error} />}
          {notice && (
            <p className="security-notice" role="status">
              {notice}
            </p>
          )}
          <Panel
            className="security-panel"
            title="Email verification"
            action={
              <span
                className={`security-state ${status.data?.emailVerifiedAt ? "is-enabled" : ""}`}
              >
                <span aria-hidden="true" />
                {status.data?.emailVerifiedAt ? "Verified" : "Not verified"}
              </span>
            }
          >
            <div className="security-section-body">
              {user?.email && <p className="security-email">{user.email}</p>}
              <p className="security-description">
                {status.data?.emailVerifiedAt
                  ? "Your email address is verified."
                  : "Verify your email to receive receipts, refund confirmations and stock alerts."}
              </p>
              {!status.data?.emailVerifiedAt && (
                <Button
                  busy={busy}
                  onClick={() =>
                    void action(async () => {
                      await write("/auth/email/verification", {});
                      setNotice("Verification email queued. Check your inbox.");
                    })
                  }
                >
                  Send verification email
                </Button>
              )}
            </div>
          </Panel>
          <Panel
            className="security-panel"
            title="Two-factor authentication"
            action={
              <span
                className={`security-state ${status.data?.mfaEnabledAt || codes.length ? "is-enabled" : ""}`}
              >
                <span aria-hidden="true" />
                {codes.length
                  ? "Recovery codes ready"
                  : status.data?.mfaEnabledAt
                    ? "Enabled"
                    : setup
                      ? "Setup in progress"
                      : "Not enabled"}
              </span>
            }
            subtitle={
              status.data?.mfaEnabledAt
                ? `${status.data.recoveryCodesRemaining} recovery codes remaining`
                : "Use an authenticator app for a second sign-in step."
            }
          >
            <div className="security-section-body">
              {codes.length ? (
                <div className="security-recovery">
                  <p className="security-description">
                    Save these recovery codes in a safe place. Each works once. All sessions have
                    been signed out; sign in again with a recovery code or the next authenticator
                    code.
                  </p>
                  <pre className="security-recovery-codes" aria-label="One-use recovery codes">
                    {codes.join("\n")}
                  </pre>
                  <Button
                    onClick={() => {
                      location.href = "/login";
                    }}
                  >
                    I saved my codes · sign in
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void action(async () => {
                      if (status.data?.mfaEnabledAt) {
                        await write("/auth/mfa/disable", { password, code });
                        setPassword("");
                        setCode("");
                        setNotice("Two-factor authentication disabled. Sign in again.");
                        location.href = "/login";
                      } else if (setup) {
                        const result = await write<{ recoveryCodes: string[] }>(
                          "/auth/mfa/confirm",
                          {
                            code,
                          },
                        );
                        setCodes(result.recoveryCodes);
                        setSetup(null);
                        setPassword("");
                        setCode("");
                      } else {
                        setSetup(await write("/auth/mfa/enroll", { password }));
                        setPassword("");
                      }
                    });
                  }}
                  className="form-stack security-form"
                >
                  {!setup && (
                    <label>
                      Current password
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        required
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  )}
                  {setup && (
                    <div className="security-enrollment">
                      <p className="security-description">
                        Scan this code or add the setup key to your authenticator app within ten
                        minutes.
                      </p>
                      <div className="security-setup-details">
                        <div className="security-qr">
                          <img
                            src={setup.qrDataUrl}
                            width={180}
                            height={180}
                            alt="Authenticator setup QR code"
                          />
                        </div>
                        <div className="security-manual-setup">
                          <span className="security-field-caption">Manual setup key</span>
                          <code className="security-setup-key">{setup.secret}</code>
                          <a className="security-text-link" href={setup.otpauthUrl}>
                            Open authenticator app
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                  {(setup || status.data?.mfaEnabledAt) && (
                    <label>
                      {setup ? "Authenticator code" : "Authenticator or recovery code"}
                      <input
                        autoComplete="one-time-code"
                        value={code}
                        maxLength={32}
                        required
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                  )}
                  <Button
                    type="submit"
                    busy={busy}
                    variant={status.data?.mfaEnabledAt ? "danger" : "primary"}
                  >
                    {status.data?.mfaEnabledAt
                      ? "Disable two-factor authentication"
                      : setup
                        ? "Verify and activate"
                        : "Set up authenticator"}
                  </Button>
                </form>
              )}
            </div>
          </Panel>
          {canSeeDelivery && (
            <Panel
              className="security-panel security-delivery"
              title="Email delivery"
              subtitle={
                delivery.data
                  ? `Delivery mode: ${delivery.data.mode}`
                  : "Delivery status for your store's email messages."
              }
              action={
                <Button variant="secondary" busy={delivery.loading} onClick={delivery.reload}>
                  Refresh
                </Button>
              }
            >
              <div className="security-section-body">
                {delivery.data?.mode === "capture" && (
                  <p className="security-description">
                    Captured messages stay local and have not been sent.
                  </p>
                )}
                {delivery.error ? (
                  <ErrorState error={delivery.error} retry={delivery.reload} />
                ) : delivery.loading && !delivery.data ? (
                  <Loading rows={3} />
                ) : delivery.data?.messages.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Message</th>
                          <th>Status</th>
                          <th>Attempts</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {delivery.data.messages.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <span className="security-message-subject">{item.subject}</span>
                              {item.lastError && (
                                <p className="security-delivery-error">{item.lastError}</p>
                              )}
                            </td>
                            <td>
                              <Status value={item.status} />
                            </td>
                            <td>{item.attempts}</td>
                            <td>{dateTime(item.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No email deliveries yet"
                    detail="Verification links, invitations and store updates will appear here when queued."
                  />
                )}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
  return staff ? (
    content
  ) : (
    <div className="shopper-page">
      <header className="shopper-header">
        <Link to="/customer" aria-label="TapCart shopping home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="shopper-main security-customer-main">
        <Link className="text-button" to="/customer">
          Back to shopping
        </Link>
        {content}
      </main>
    </div>
  );
}
export function AccountRecovery({
  mode,
  onDone,
}: {
  mode?: "forgot" | "reset" | "verify";
  onDone?: () => void;
}) {
  const selected =
    mode ||
    (location.pathname.includes("reset")
      ? "reset"
      : location.pathname.includes("verify")
        ? "verify"
        : "forgot");
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("token") || "");
  useEffect(() => {
    if (token) history.replaceState(null, "", location.pathname);
  }, [token]);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await session();
      if (selected === "forgot") await write("/auth/password/forgot", { email });
      else if (selected === "reset") await write("/auth/password/reset", { token, password });
      else await write("/auth/email/verify", { token });
      setDone(true);
      setPassword("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-form-side" style={{ minHeight: "100dvh" }}>
      <div className="auth-form-wrap">
        <Panel
          title={
            selected === "forgot"
              ? "Reset your password"
              : selected === "reset"
                ? "Choose a new password"
                : "Verify your email"
          }
        >
          {error && <ErrorState error={error} />}
          {done ? (
            <>
              <p role="status">
                {selected === "forgot"
                  ? "If your account is eligible, a reset email will arrive shortly. The link expires in 30 minutes."
                  : selected === "reset"
                    ? "Password changed. Sign in again; your other sessions have expired."
                    : "Email verified."}
              </p>
              {onDone ? (
                <Button onClick={onDone}>Continue</Button>
              ) : (
                <Link to="/login">Return to sign in</Link>
              )}
            </>
          ) : (
            <form className="form-stack" onSubmit={submit}>
              {selected === "forgot" && (
                <label>
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    maxLength={254}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {selected === "reset" && (
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    required
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {selected !== "forgot" && !token && (
                <p role="alert">Open the full link from your email.</p>
              )}
              <Button type="submit" busy={busy} disabled={selected !== "forgot" && !token}>
                {selected === "forgot"
                  ? "Send reset email"
                  : selected === "reset"
                    ? "Change password"
                    : "Verify email"}
              </Button>
              <Link to="/login">Back to sign in</Link>
            </form>
          )}
        </Panel>
      </div>
    </main>
  );
}
export function MfaLoginForm({
  challengeToken,
  onComplete,
}: {
  challengeToken: string;
  onComplete: (value: Session) => void;
}) {
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await write("/auth/mfa/login", { challengeToken, code });
          onComplete(await session());
        } catch (e) {
          setError(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <ErrorState error={error} />}
      <label>
        Authenticator or recovery code
        <input
          autoComplete="one-time-code"
          autoFocus
          value={code}
          maxLength={32}
          required
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <Button type="submit" busy={busy}>
        Verify sign in
      </Button>
    </form>
  );
}
export async function capturedDevelopmentEmail() {
  return api<{ id: string; subject: string; body: string; status: string }[]>(
    "/auth/security/captured-email",
  );
}
