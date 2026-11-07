import { Button } from "./ui";
import { tapProof } from "./nfc-proof";
import React, { useEffect, useId, useRef, useState } from "react";
import { api, write, message } from "./api";
import "./nfc.css";
type NfcTool = "encode" | "authenticated" | "field";
const nfcTools: { id: NfcTool; label: string }[] = [
  { id: "encode", label: "Encode" },
  { id: "authenticated", label: "Authenticated tags" },
  { id: "field", label: "Field testing" },
];
export function NfcTools({ unitId }: { unitId: string }) {
  const [selected, setSelected] = useState<NfcTool>("encode");
  const namespace = useId();
  function navigate(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % nfcTools.length
        : event.key === "ArrowLeft"
          ? (index + nfcTools.length - 1) % nfcTools.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? nfcTools.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(nfcTools[next]!.id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(next)
      ?.focus();
  }
  return (
    <div className="nfc-tools">
      <div className="nfc-tabs" role="tablist" aria-label="NFC tools">
        {nfcTools.map((tool, index) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            className="nfc-tab"
            id={`${namespace}-${tool.id}-tab`}
            aria-controls={`${namespace}-${tool.id}-panel`}
            aria-selected={selected === tool.id}
            tabIndex={selected === tool.id ? 0 : -1}
            onClick={() => setSelected(tool.id)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        className="nfc-panel"
        role="tabpanel"
        id={`${namespace}-encode-panel`}
        aria-labelledby={`${namespace}-encode-tab`}
        hidden={selected !== "encode"}
        tabIndex={0}
      >
        <NfcEncoder unitId={unitId} active={selected === "encode"} />
      </div>
      <div
        className="nfc-panel"
        role="tabpanel"
        id={`${namespace}-authenticated-panel`}
        aria-labelledby={`${namespace}-authenticated-tab`}
        hidden={selected !== "authenticated"}
        tabIndex={0}
      >
        {selected === "authenticated" && <NfcTagRegistration unitId={unitId} />}
      </div>
      <div
        className="nfc-panel"
        role="tabpanel"
        id={`${namespace}-field-panel`}
        aria-labelledby={`${namespace}-field-tab`}
        hidden={selected !== "field"}
        tabIndex={0}
      >
        <NfcFieldMeasurement unitId={unitId} active={selected === "field"} />
      </div>
    </div>
  );
}
type Reading = { message: { records: { recordType: string; data: DataView }[] } };
export interface NdefReader extends EventTarget {
  write(
    message: { records: { recordType: "url"; data: string }[] },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  makeReadOnly?: (options?: { signal?: AbortSignal }) => Promise<void>;
}
type ReaderConstructor = new () => NdefReader;
function readerConstructor(): ReaderConstructor | undefined {
  return (window as unknown as { NDEFReader?: ReaderConstructor }).NDEFReader;
}
export const webNfcSupported = () => window.isSecureContext && Boolean(readerConstructor());
export function readExactUri(
  reader: NdefReader,
  timeout = 30_000,
  signal?: AbortSignal,
): Promise<string> {
  const abort = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("No NFC read observed before timeout."));
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCancel);
      abort.abort();
      reader.removeEventListener("reading", onRead);
      reader.removeEventListener("readingerror", onError);
    }
    function onCancel() {
      cleanup();
      reject(new Error("NFC scan cancelled."));
    }
    if (signal?.aborted) {
      onCancel();
      return;
    }
    signal?.addEventListener("abort", onCancel, { once: true });
    function onError() {
      cleanup();
      reject(new Error("NFC record could not be read."));
    }
    function onRead(event: Event) {
      const records = (event as unknown as Reading).message.records;
      if (records.length !== 1 || records[0]?.recordType !== "url") {
        cleanup();
        reject(new Error("Expected exactly one NDEF URI record."));
        return;
      }
      const uri = new TextDecoder().decode(records[0].data);
      cleanup();
      resolve(uri);
    }
    reader.addEventListener("reading", onRead);
    reader.addEventListener("readingerror", onError);
    reader.scan({ signal: abort.signal }).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}
type Job = { id: string; expectedUri: string; status: string };
export function NfcEncoder({ unitId, active = true }: { unitId: string; active?: boolean }) {
  return <NfcEncoderSession key={unitId} unitId={unitId} active={active} />;
}
function NfcEncoderSession({ unitId, active }: { unitId: string; active: boolean }) {
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), [unitId, active]);
  const [job, setJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  async function observe(kind: string, extra: Record<string, unknown> = {}) {
    if (!job) throw new Error("Create an encoder job first.");
    const result = await write<Job>(`/nfc/jobs/${job.id}/observations`, { kind, ...extra });
    setJob(result);
    return result;
  }
  async function run(action: () => Promise<void>) {
    operation.current?.abort();
    operation.current = new AbortController();
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      let detail = message(e);
      if (job && (action === writeTag || action === lock)) {
        try {
          await observe("FAILURE", { detail });
        } catch (logError) {
          detail += ` Failure observation could not be saved: ${message(logError)}`;
        }
      }
      setError(detail);
    } finally {
      setBusy(false);
    }
  }
  async function writeTag() {
    const Constructor = readerConstructor();
    if (!Constructor) throw new Error("Web NFC is unavailable.");
    const reader = new Constructor();
    await reader.write(
      { records: [{ recordType: "url", data: job!.expectedUri }] },
      { signal: operation.current?.signal },
    );
    await observe("WRITE_RESOLVED");
  }
  async function verify() {
    const Constructor = readerConstructor();
    if (!Constructor) throw new Error("Web NFC is unavailable.");
    try {
      const uri = await readExactUri(new Constructor(), 30_000, operation.current?.signal);
      await observe("READ_BACK", { observedUri: uri });
      if (uri !== job?.expectedUri)
        throw new Error("URI mismatch. Do not attach or lock this tag.");
    } catch (e) {
      if (job?.status === "WRITTEN") await observe("FAILURE", { detail: message(e) });
      throw e;
    }
  }
  async function lock() {
    if (!confirmed || job?.status !== "VERIFIED")
      throw new Error("Review verification and confirm permanent locking first.");
    const Constructor = readerConstructor();
    if (!Constructor) throw new Error("Web NFC is unavailable.");
    const reader = new Constructor();
    if (!reader.makeReadOnly) throw new Error("This browser cannot permanently lock NFC tags.");
    await reader.makeReadOnly({ signal: operation.current?.signal });
    await observe("LOCK_RESOLVED", { irreversibleLockConfirmed: true });
  }
  const phase = job?.status;
  const readyToCreate = !job || phase === "FAILED" || phase === "LOCKED";
  const phaseLabel = phase
    ? ({
        CREATED: "Ready to write",
        WRITTEN: "Ready to verify",
        VERIFIED: "URI verified",
        LOCKED: "Permanently locked",
        FAILED: "New session needed",
      }[phase] ?? phase)
    : "Not started";
  return (
    <section className="nfc-section" aria-label="NFC encoder">
      <header className="nfc-section-heading">
        <div>
          <h3>Write and verify a tag</h3>
          <p>Encode this unit’s link, then check it on the tag.</p>
        </div>
        <span className="nfc-state" role="status">
          {phaseLabel}
        </span>
      </header>
      {!webNfcSupported() && (
        <div className="nfc-callout">
          <strong>Use a compatible NFC-enabled phone</strong>
          <p>
            Open this page over HTTPS in a browser that supports Web NFC, such as compatible Android
            Chrome.
          </p>
        </div>
      )}
      {error && (
        <p className="nfc-feedback" role="alert">
          {error}
        </p>
      )}
      <ol className="nfc-steps">
        <li data-state={readyToCreate ? "current" : "complete"}>
          <span className="nfc-step-number" aria-hidden="true">
            1
          </span>
          <div className="nfc-step-body">
            <h4>Prepare the link</h4>
            <p>
              {job
                ? "The unit link is recorded for this encoder session."
                : "Create an encoder session for this physical unit."}
            </p>
            {job?.expectedUri && <code className="nfc-uri">{job.expectedUri}</code>}
            {readyToCreate && (
              <div className="nfc-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setJob(await write<Job>("/nfc/jobs", { unitId }));
                      setConfirmed(false);
                    })
                  }
                >
                  {job ? "Create new encoder job" : "Create encoder job"}
                </Button>
              </div>
            )}
          </div>
        </li>
        <li
          data-state={
            phase === "CREATED"
              ? "current"
              : phase && ["WRITTEN", "VERIFIED", "LOCKED"].includes(phase)
                ? "complete"
                : "next"
          }
        >
          <span className="nfc-step-number" aria-hidden="true">
            2
          </span>
          <div className="nfc-step-body">
            <h4>Write the tag</h4>
            <p>Hold one writable tag against the phone’s NFC reader.</p>
            {phase === "CREATED" && (
              <div className="nfc-actions">
                <Button disabled={busy || !webNfcSupported()} onClick={() => void run(writeTag)}>
                  {busy ? "Waiting for tag…" : "Write tag"}
                </Button>
              </div>
            )}
          </div>
        </li>
        <li
          data-state={
            phase === "WRITTEN"
              ? "current"
              : phase && ["VERIFIED", "LOCKED"].includes(phase)
                ? "complete"
                : "next"
          }
        >
          <span className="nfc-step-number" aria-hidden="true">
            3
          </span>
          <div className="nfc-step-body">
            <h4>Read back and verify</h4>
            <p>Remove the tag, present it again, and compare the exact link.</p>
            {phase === "WRITTEN" && (
              <div className="nfc-actions">
                <Button disabled={busy || !webNfcSupported()} onClick={() => void run(verify)}>
                  {busy ? "Waiting for read-back…" : "Read back and verify"}
                </Button>
              </div>
            )}
          </div>
        </li>
      </ol>
      {phase === "VERIFIED" && (
        <div className="nfc-lock">
          <h4>Optional: permanently lock this tag</h4>
          <p>Review the verified link above before continuing. Locking cannot be undone.</p>
          <label className="nfc-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed the exact verified URI. I understand permanent tag locking is irreversible.
            </span>
          </label>
          <div className="nfc-actions">
            <Button
              variant="secondary"
              disabled={busy || !confirmed}
              onClick={() => void run(lock)}
            >
              Permanently lock verified tag
            </Button>
          </div>
        </div>
      )}
      <details className="nfc-details">
        <summary>Encoding limits and recorded evidence</summary>
        <div>
          <p>
            This writes a static NDEF URI. Browser-reported write, read-back and locking results are
            recorded against the unit and encoder session; they do not prove tag authenticity or
            physical attachment.
          </p>
          <p>
            Web NFC cannot personalize NTAG424 AES keys or SDM settings. Use a hardware encoder,
            then register the configuration in Authenticated tags.
          </p>
        </div>
      </details>
    </section>
  );
}

interface TrialSummary {
  device: string;
  tag: string;
  material: string;
  carrier: string;
  trials: number;
  successes: number;
  wilson95: [number, number];
  meets100TrialMinimum: boolean;
}
interface Trial {
  traceId: string;
  unitId: string;
  device: string;
  tag: string;
  material: string;
  carrier: "NFC" | "QR";
  outcome: string;
  browserUriMs: number | null;
  reservationMs: number | null;
  reservationId: string | null;
  detail: string;
}
export function NfcFieldMeasurement({
  unitId,
  active = true,
}: {
  unitId: string;
  active?: boolean;
}) {
  return <NfcFieldSession key={unitId} unitId={unitId} active={active} />;
}
function NfcFieldSession({ unitId, active }: { unitId: string; active: boolean }) {
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), [unitId, active]);
  const [device, setDevice] = useState(""),
    [tag, setTag] = useState(""),
    [material, setMaterial] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [summary, setSummary] = useState<TrialSummary[]>([]);
  async function refreshSummary() {
    setSummary(
      await api<TrialSummary[]>(`/nfc/field-trials/summary?unitId=${encodeURIComponent(unitId)}`),
    );
  }
  async function trial() {
    operation.current?.abort();
    operation.current = new AbortController();
    setBusy(true);
    const start = performance.now(),
      result: Trial = {
        traceId: crypto.randomUUID(),
        unitId,
        device,
        tag,
        material,
        carrier: "NFC",
        outcome: "BROWSER_ERROR",
        browserUriMs: null,
        reservationMs: null,
        reservationId: null,
        detail: "",
      };
    try {
      const Constructor = readerConstructor();
      if (!Constructor) throw new Error("Web NFC unavailable.");
      result.outcome = "READ_FAILURE";
      const uri = await readExactUri(new Constructor(), 30_000, operation.current?.signal);
      result.browserUriMs = performance.now() - start;
      const url = new URL(uri);
      if (url.origin !== location.origin || url.pathname !== `/u/${unitId}`) {
        result.outcome = "URI_MISMATCH";
        throw new Error("Observed URI does not match this unit.");
      }
      const unit = await api<{ version: number }>(`/units/${unitId}`);
      result.outcome = "RESERVATION_REJECTED";
      const reserveStart = performance.now();
      try {
        const reserved = await write<{ reservationId: string }>(
          "/nfc/field-reservations",
          {
            unitId,
            version: unit.version,
            tap: tapProof(url),
          },
          "POST",
          result.traceId,
        );
        result.reservationMs = performance.now() - reserveStart;
        result.reservationId = reserved.reservationId;
        result.outcome = "SUCCESS";
      } catch (e) {
        result.reservationMs = performance.now() - reserveStart;
        throw e;
      }
    } catch (e) {
      result.detail = message(e);
      if (operation.current?.signal.aborted) result.outcome = "CANCELLED";
    } finally {
      try {
        await write("/nfc/field-trials", result);
        await refreshSummary();
        setStatus(
          `${result.outcome} · trace ${result.traceId}${result.detail ? `: ${result.detail}` : ""}`,
        );
      } catch (e) {
        setStatus(
          `Trial could not be saved: ${message(e)}. Trace ${result.traceId}; outcome ${result.outcome}.`,
        );
      }
      setBusy(false);
    }
  }
  return (
    <section className="nfc-section" aria-label="NFC field testing">
      <header className="nfc-section-heading">
        <div>
          <h3>Measure a physical trial</h3>
          <p>Record the device, tag and material before starting.</p>
        </div>
      </header>
      <div className="nfc-form-grid">
        <label>
          Device and browser
          <input
            value={device}
            onChange={(event) => setDevice(event.target.value)}
            placeholder="e.g. Pixel 9 · Chrome"
          />
        </label>
        <label>
          Tag model
          <input
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="e.g. NTAG213"
          />
        </label>
        <label className="nfc-field-full">
          Attachment material
          <input
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            placeholder="e.g. Cardboard packaging"
          />
        </label>
      </div>
      {!webNfcSupported() && (
        <p className="nfc-callout">
          A compatible NFC-enabled phone and Web NFC browser are required to run a trial.
        </p>
      )}
      <div className="nfc-actions">
        <Button
          disabled={busy || !device || !tag || !material || !webNfcSupported()}
          onClick={() => void trial()}
        >
          {busy ? "Trial in progress…" : "Start NFC trial"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void refreshSummary().catch((error) => setStatus(message(error)))}
        >
          Load recorded trial summary
        </Button>
      </div>
      {status && (
        <p className="nfc-feedback" role="status">
          {status}
        </p>
      )}
      {summary.length > 0 && (
        <div className="nfc-results">
          <h4>Recorded trials</h4>
          {summary.map((group, index) => (
            <div className="nfc-result" key={index}>
              <strong>
                {group.successes}/{group.trials} successful
              </strong>
              <p>
                {group.device} · {group.tag} · {group.material} · {group.carrier}
              </p>
              <p>
                Wilson 95% interval: {(group.wilson95[0] * 100).toFixed(1)}–
                {(group.wilson95[1] * 100).toFixed(1)}%.
              </p>
              {!group.meets100TrialMinimum && (
                <p>Fewer than 100 trials: acceptance evidence is incomplete.</p>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="nfc-details">
        <summary>What this trial measures</summary>
        <div>
          <p>
            Place a real tag on the recorded material. Each attempt records browser URI latency and
            a controlled API reservation followed by immediate release. Read failures and
            unsuccessful attempts remain in the reliability denominator.
          </p>
          <p>
            These are physical trials you perform with your device. No measurement is created until
            you run and save a trial.
          </p>
        </div>
      </details>
    </section>
  );
}

interface TagConfiguration {
  unitId: string;
  policy: string;
  canConfigure: boolean;
  keyStorageConfigured: boolean;
  registration: { uid: string; scheme: string; lastCounter: number; createdAt: string } | null;
}
export function NfcTagRegistration({ unitId }: { unitId: string }) {
  return <NfcTagRegistrationSession key={unitId} unitId={unitId} />;
}
function NfcTagRegistrationSession({ unitId }: { unitId: string }) {
  const [configuration, setConfiguration] = useState<TagConfiguration | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<TagConfiguration>(`/nfc/tags/${encodeURIComponent(unitId)}`, { signal: controller.signal })
      .then(setConfiguration)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [unitId]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      uid = String(data.get("uid") ?? "")
        .trim()
        .toUpperCase(),
      sdmFileReadKey = String(data.get("sdmFileReadKey") ?? "");
    const confirmed = data.get("hardwarePersonalizationConfirmed") === "on";
    // Clear the password element before any asynchronous work; raw keys never enter React state or persistent browser storage.
    form.reset();
    setError("");
    setNotice("");
    if (!confirmed) {
      setError("Confirm completed hardware personalization first.");
      return;
    }
    setBusy(true);
    try {
      await write("/nfc/tags", {
        unitId,
        uid,
        sdmFileReadKey,
        profile: "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
        hardwarePersonalizationConfirmed: true,
      });
      setConfiguration(await api<TagConfiguration>(`/nfc/tags/${encodeURIComponent(unitId)}`));
      setNotice("Authenticated tag registered. Future reservations require a fresh valid SDM tap.");
    } catch (e) {
      setError(`${message(e)} The key input was cleared; enter it again only when retrying.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="nfc-section" aria-label="Authenticated tag configuration">
      <header className="nfc-section-heading">
        <div>
          <h3>Register an authenticated tag</h3>
          <p>Connect a tag already personalized by a hardware encoder.</p>
        </div>
      </header>
      <details className="nfc-details">
        <summary>Supported hardware configuration</summary>
        <div>
          <p>
            Only NTAG424 DNA SDM in AES mode is supported: plaintext UID and read counter, with
            equal SDMMACInputOffset and SDMMACOffset (empty MAC input). Web NFC cannot configure AES
            keys or these hardware settings.
          </p>
        </div>
      </details>
      {error && (
        <p className="nfc-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="nfc-feedback" role="status">
          {notice}
        </p>
      )}
      {!configuration && !error && <p role="status">Loading tag configuration…</p>}
      {configuration && (
        <>
          <p className="nfc-policy">
            Current policy <span className="nfc-state">{configuration.policy}</span>
          </p>
          {configuration.registration ? (
            <dl className="nfc-metadata">
              <dt>Registered UID</dt>
              <dd>{configuration.registration.uid}</dd>
              <dt>Profile</dt>
              <dd>{configuration.registration.scheme}</dd>
              <dt>Last accepted read counter</dt>
              <dd>
                {configuration.registration.lastCounter < 0
                  ? "No verified tap yet"
                  : configuration.registration.lastCounter}
              </dd>
            </dl>
          ) : (
            <p>No authenticated tag is registered for this unit.</p>
          )}
          {!configuration.canConfigure && (
            <p>Only a store owner, manager, or administrator can register authenticated tags.</p>
          )}
          {configuration.canConfigure && !configuration.keyStorageConfigured && (
            <p role="status">
              Authenticated NFC key storage is not configured on the server. Configure
              NFC_MASTER_KEY before registering tags.
            </p>
          )}
          {configuration.canConfigure &&
            configuration.keyStorageConfigured &&
            !configuration.registration && (
              <form
                className="nfc-form"
                onSubmit={(event) => void submit(event)}
                autoComplete="off"
              >
                <label>
                  Hardware tag UID
                  <input
                    name="uid"
                    required
                    pattern="[0-9A-Fa-f]{14}"
                    minLength={14}
                    maxLength={14}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="14 hexadecimal characters"
                    disabled={busy}
                  />
                </label>
                <label>
                  Personalized AES-128 SDM file-read key
                  <input
                    name="sdmFileReadKey"
                    type="password"
                    required
                    pattern="[0-9A-Fa-f]{32}"
                    minLength={32}
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    placeholder="32 hexadecimal characters"
                    disabled={busy}
                  />
                </label>
                <p className="nfc-field-hint">
                  Use the unique key already written to the tag. This field is cleared on
                  submission; the key is encrypted on the server and never returned.
                </p>
                <label className="nfc-check">
                  <input
                    name="hardwarePersonalizationConfirmed"
                    type="checkbox"
                    required
                    disabled={busy}
                  />
                  <span>
                    I confirm this physical tag has been personalized with this UID, key and exact
                    supported SDM profile, and its hardware key permissions have been secured. I
                    understand this enables authenticated-tap requirements for this unit.
                  </span>
                </label>
                <div className="nfc-actions">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Registering tag…" : "Register authenticated tag"}
                  </Button>
                </div>
              </form>
            )}
          {configuration.registration && (
            <p>
              Registration and the replay counter cannot be reset here. Tag replacement or key
              rotation requires an audited hardware and database migration.
            </p>
          )}
        </>
      )}
    </section>
  );
}
