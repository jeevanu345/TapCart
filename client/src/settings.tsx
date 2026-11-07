import { Select } from "./select";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Copy, Trash2, UserPlus } from "lucide-react";
import { PLANS, planById, type PlanId } from "../../server/plans";
import { date, message, useData, write, type Team as TeamData, type Workspace } from "./api";
import { homeFor, useAuth } from "./App";
import { AuthFrame, PasswordInput } from "./auth";
import {
  Button,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageTitle,
  Panel,
  Status,
  useNotify,
} from "./ui";
export function Settings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const store = user?.role === "STORE";
  const tabs = store
    ? [
        ["store", "Store"],
        ["team", "Team"],
        ["plan", "Plan & usage"],
        ["account", "Account"],
      ]
    : [["account", "Account"]];
  const requested = params.get("tab");
  const tab = tabs.some(([value]) => value === requested) ? requested : tabs[0][0];
  return (
    <>
      <PageTitle title="Settings" description="Your store, your team and your account." />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Settings sections">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setParams({ tab: value }, { replace: true })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "store" && <StoreSettings />}
      {tab === "team" && <TeamSettings />}
      {tab === "plan" && <PlanSettings />}
      {tab === "account" && <AccountSettings />}
    </>
  );
}
const canManage = (role?: string | null) => role === "OWNER" || role === "MANAGER";
function StoreSettings() {
  const { user } = useAuth();
  const workspace = useData<Workspace>("/workspace");
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (workspace.loading && !workspace.data) return <Loading />;
  if (workspace.error || !workspace.data)
    return <ErrorState error={workspace.error || "Store unavailable"} retry={workspace.reload} />;
  const store = workspace.data.store;
  const locked = !canManage(user?.storeRole);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await write(
        "/workspace",
        {
          name: form.get("name"),
          address: form.get("address"),
          phone: form.get("phone"),
          supportEmail: form.get("supportEmail"),
          lowStockThreshold: Number(form.get("lowStockThreshold")),
        },
        "PATCH",
      );
      notify("Store settings saved.");
      workspace.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Store details" subtitle={locked ? "Only managers can change these." : undefined}>
      <form className="form-stack narrow" onSubmit={submit}>
        <fieldset disabled={locked} className="plain-fieldset">
          <div className="form-grid">
            <label>
              Store name
              <input name="name" required maxLength={200} defaultValue={store.name} />
            </label>
            <label>
              Phone
              <input name="phone" maxLength={40} defaultValue={store.phone} autoComplete="tel" />
            </label>
            <label className="span-2">
              Address
              <input name="address" maxLength={500} defaultValue={store.address} />
            </label>
            <label>
              Support email
              <input name="supportEmail" type="email" defaultValue={store.supportEmail} />
            </label>
            <label>
              Low-stock threshold
              <input
                name="lowStockThreshold"
                type="number"
                min={0}
                max={1000}
                required
                defaultValue={store.lowStockThreshold}
              />
              <small>Products at or below this many available units are flagged.</small>
            </label>
          </div>
          {error && <ErrorState error={error} />}
          {!locked && (
            <Button type="submit" busy={busy}>
              Save changes
            </Button>
          )}
        </fieldset>
      </form>
    </Panel>
  );
}
function TeamSettings() {
  const { user } = useAuth();
  const team = useData<TeamData>("/team");
  const notify = useNotify();
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manage = canManage(user?.storeRole);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await write<{ token: string }>("/team/invites", {
        role: form.get("role"),
        email: form.get("email"),
      });
      setLink(`${window.location.origin}/invite/${result.token}`);
      team.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function act(run: () => Promise<unknown>, success: string) {
    setError("");
    try {
      await run();
      notify(success);
      team.reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      {error && !inviting && <ErrorState error={error} />}
      <Panel
        title="Team"
        subtitle="Everyone with access to this store."
        action={
          manage && (
            <Button
              onClick={() => {
                setError("");
                setLink("");
                setInviting(true);
              }}
            >
              <UserPlus size={15} />
              Invite teammate
            </Button>
          )
        }
      >
        {team.loading && !team.data ? (
          <Loading />
        ) : team.error ? (
          <ErrorState error={team.error} retry={team.reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {team.data?.members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="customer-cell">
                        <span className="avatar small">
                          {member.name.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>{member.name}</strong>
                      </div>
                    </td>
                    <td>{member.email}</td>
                    <td>
                      <Status value={member.role} />
                    </td>
                    <td>{date(member.createdAt)}</td>
                    <td className="number">
                      {manage && member.role !== "OWNER" && member.id !== user?.id && (
                        <button
                          className="icon-button"
                          aria-label={`Remove ${member.name}`}
                          onClick={() => setRemoving(member)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {!!team.data?.invites.length && (
        <Panel title="Open invitations" subtitle="Links work once and expire after seven days.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>For</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {team.data.invites.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email || "Anyone with the link"}</td>
                    <td>
                      <Status value={invitation.role} />
                    </td>
                    <td>{date(invitation.expiresAt)}</td>
                    <td className="number">
                      {manage && (
                        <button
                          className="text-button"
                          onClick={() =>
                            act(
                              () => write(`/team/invites/${invitation.id}`, {}, "DELETE"),
                              "Invitation revoked.",
                            )
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {inviting && (
        <Modal
          title={link ? "Share this link" : "Invite a teammate"}
          description={
            link
              ? "TapCart does not send email yet, so send this yourself. It is shown only once."
              : "You get a single-use link to send them."
          }
          onClose={() => setInviting(false)}
        >
          {link ? (
            <div className="form-stack">
              <input readOnly aria-label="Invitation link" value={link} className="mono" />
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    notify("Invitation link copied.");
                  } catch {
                    notify("Clipboard unavailable. Select the link and copy it.");
                  }
                }}
              >
                <Copy size={15} />
                Copy link
              </Button>
            </div>
          ) : (
            <form className="form-stack" onSubmit={invite}>
              <label>
                Role
                <Select name="role" defaultValue="STAFF">
                  <option value="STAFF">Staff: run the floor and desk</option>
                  <option value="MANAGER">Manager: also manage team and settings</option>
                </Select>
              </label>
              <label>
                Their email (optional)
                <input name="email" type="email" />
                <small>If set, only this address can use the link.</small>
              </label>
              {error && <ErrorState error={error} />}
              <Button type="submit" busy={busy}>
                Create invitation link
              </Button>
            </form>
          )}
        </Modal>
      )}
      {removing && (
        <Modal
          title={`Remove ${removing.name}?`}
          description="They lose store access immediately. Their account stays as a shopper."
          onClose={() => setRemoving(null)}
        >
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep them
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = removing.id;
                setRemoving(null);
                void act(() => write(`/team/members/${id}`, {}, "DELETE"), "Teammate removed.");
              }}
            >
              Remove access
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  return (
    <div className="meter">
      <span>{label}</span>
      <strong>
        {used.toLocaleString("en-IN")}
        <small> / {limit === null ? "no limit" : limit.toLocaleString("en-IN")}</small>
      </strong>
      {limit !== null && (
        <i role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={limit}>
          <b style={{ transform: `scaleX(${share})` }} />
        </i>
      )}
    </div>
  );
}
function PlanSettings() {
  const { user } = useAuth();
  const workspace = useData<Workspace>("/workspace");
  const notify = useNotify();
  const [error, setError] = useState("");
  if (workspace.loading && !workspace.data) return <Loading />;
  if (workspace.error || !workspace.data)
    return <ErrorState error={workspace.error || "Plan unavailable"} retry={workspace.reload} />;
  const { store, usage } = workspace.data;
  const current = planById(store.plan);
  async function request(plan: PlanId | null) {
    setError("");
    try {
      await write("/workspace/plan-request", { plan });
      notify(plan ? "Request sent to your administrator." : "Plan request withdrawn.");
      workspace.reload();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <Panel title={`${current.name} plan`} subtitle={current.summary}>
        <div className="meters">
          <Meter label="Active products" used={usage.products} limit={current.limits.products} />
          <Meter label="Unsold units" used={usage.units} limit={current.limits.units} />
          <Meter
            label="Team seats"
            used={usage.seats + usage.invites}
            limit={current.limits.seats}
          />
        </div>
      </Panel>
      {error && <ErrorState error={error} />}
      <div className="plan-grid">
        {PLANS.map((plan) => (
          <article className="panel plan-card" key={plan.id} data-current={plan.id === store.plan}>
            <h3>{plan.name}</h3>
            <p className="plan-price">
              <strong>{plan.price}</strong> {plan.cadence}
            </p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check size={14} />
                  {feature}
                </li>
              ))}
            </ul>
            {plan.id === store.plan ? (
              <Button variant="secondary" disabled>
                Current plan
              </Button>
            ) : store.planRequested === plan.id ? (
              <Button variant="secondary" onClick={() => request(null)}>
                Withdraw request
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={!canManage(user?.storeRole)}
                onClick={() => request(plan.id)}
              >
                Request {plan.name}
              </Button>
            )}
          </article>
        ))}
      </div>
      <p className="quiet-note">
        Online billing is not connected yet. An administrator reviews and applies plan requests, and
        no charge is made in TapCart.
      </p>
    </>
  );
}
function AccountSettings() {
  const { user, refresh } = useAuth();
  const notify = useNotify();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function profile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("profile");
    setError("");
    try {
      await write(
        "/auth/profile",
        { name: new FormData(event.currentTarget).get("name") },
        "PATCH",
      );
      await refresh();
      notify("Name updated.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    if (form.get("next") !== form.get("confirm")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy("password");
    setError("");
    try {
      await write("/auth/password", { current: form.get("current"), next: form.get("next") });
      target.reset();
      notify("Password changed. Other devices were signed out.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {error && <ErrorState error={error} />}
      <Panel title="Profile">
        <form className="form-stack narrow" onSubmit={profile}>
          <label>
            Name
            <input name="name" required maxLength={200} defaultValue={user?.name} />
          </label>
          <label>
            Email
            <input value={user?.email || ""} readOnly />
          </label>
          <Button type="submit" busy={busy === "profile"}>
            Save name
          </Button>
        </form>
      </Panel>
      <Panel title="Password" subtitle="Changing it signs you out everywhere else.">
        <form className="form-stack narrow" onSubmit={password}>
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password
            <input
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <Button type="submit" busy={busy === "password"}>
            Change password
          </Button>
        </form>
      </Panel>
    </>
  );
}
export function AcceptInvite() {
  const { token } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const invite = useData<{ storeName: string; role: string; email: string }>(`/invites/${token}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    if (joined && user) navigate(homeFor(user), { replace: true });
  }, [joined, user, navigate]);
  if (user && !joined) return <Navigate to={homeFor(user)} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await write(`/invites/${token}/accept`, {
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      });
      await refresh();
      setJoined(true);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <AuthFrame>
      {invite.loading ? (
        <Loading />
      ) : invite.error || !invite.data ? (
        <Empty title="This link no longer works" detail={invite.error}>
          <p>Ask your store manager for a new invitation.</p>
        </Empty>
      ) : (
        <>
          <h2>Join {invite.data.storeName}</h2>
          <p>
            You were invited as {invite.data.role === "MANAGER" ? "a manager" : "staff"}. Create
            your account to continue.
          </p>
          <form className="form-stack" onSubmit={submit}>
            <label>
              Your name
              <input name="name" required autoComplete="name" />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                defaultValue={invite.data.email}
                readOnly={!!invite.data.email}
              />
            </label>
            <PasswordInput register />
            {error && <ErrorState error={error} />}
            <Button type="submit" busy={busy}>
              Join store
              <ArrowRight size={16} />
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}
