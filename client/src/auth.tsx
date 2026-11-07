import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { message, write } from "./api";
import { MfaLoginForm } from "./security";
import { homeFor, useAuth } from "./App";
import { Button, ErrorState, Logo, LogoMark, ThemeToggle } from "./ui";
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-story" aria-hidden="true">
        <Link to="/" tabIndex={-1}>
          <Logo />
        </Link>
        <div className="auth-mark">
          <LogoMark size={148} alive />
        </div>
        <p className="auth-line">
          One tag. One unit.
          <br />
          One owner at a time.
        </p>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <Link to="/" className="auth-mobile-logo" aria-label="TapCart home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="auth-form-wrap">{children}</div>
      </section>
    </div>
  );
}
export function PasswordInput({ register = false }: { register?: boolean }) {
  const [show, setShow] = useState(false);
  return (
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
          placeholder={register ? "At least 12 characters" : ""}
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
  );
}
export function AuthPage({ register = false }: { register?: boolean }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const params = new URLSearchParams(location.search);
  const [role, setRole] = useState<"STORE" | "CUSTOMER">("STORE");
  const requested = params.get("returnTo");
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
      else {
        const result = await write<{ mfaRequired?: boolean; challengeToken?: string }>(
          "/auth/login",
          { email: form.get("email"), password: form.get("password") },
        );
        if (result.mfaRequired && result.challengeToken) {
          setChallengeToken(result.challengeToken);
          return;
        }
      }
      const updated = await refresh();
      if (updated.user) navigate(returnTo || homeFor(updated.user));
      else setError("Please sign in again.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      <h2>{register ? "Create your account" : "Sign in to TapCart"}</h2>
      <p>
        {register
          ? "Stores are reviewed by an administrator before their workspace opens."
          : "Your store, your orders and every tagged unit."}
      </p>
      {challengeToken ? (
        <>
          <MfaLoginForm
            challengeToken={challengeToken}
            onComplete={async () => {
              const updated = await refresh();
              if (updated.user) navigate(returnTo || homeFor(updated.user));
            }}
          />
          <Button variant="ghost" onClick={() => setChallengeToken("")}>
            Use a different account
          </Button>
        </>
      ) : (
        <form onSubmit={submit} className="form-stack">
          {register && (
            <>
              <div className="segmented" role="group" aria-label="Account type">
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
                <input name="name" autoComplete="name" required />
              </label>
            </>
          )}
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <PasswordInput register={register} />
          {register && role === "STORE" && (
            <>
              <label>
                Store name
                <input name="storeName" required />
              </label>
              <label>
                Store address
                <input name="address" required autoComplete="street-address" />
              </label>
            </>
          )}
          {error && <ErrorState error={error} />}
          <Button busy={busy} type="submit">
            {register ? "Create account" : "Sign in to your workspace"}
            <ArrowRight size={16} />
          </Button>
        </form>
      )}
      {!register && (
        <p className="auth-switch">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
      )}
      <p className="auth-switch">
        {register ? "Already have an account?" : "New to TapCart?"}{" "}
        <Link
          to={`${register ? "/login" : "/register"}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
        >
          {register ? "Sign in" : "Create an account"}
        </Link>
      </p>
      <p className="auth-switch">
        <Link to="/customer">
          Browse as a shopper <ArrowUpRight size={13} />
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
        </details>
      )}
    </AuthFrame>
  );
}
