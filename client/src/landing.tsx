import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Play } from "lucide-react";
import { PLANS } from "../../server/plans";
import { Logo, LogoMark, Status } from "./ui";
const STATES = [
  { status: "AVAILABLE", line: "On the shelf. Anyone can tap it.", hold: "" },
  { status: "RESERVED", line: "Held for one shopper while they keep browsing.", hold: "Held 4:32" },
  { status: "SOLD", line: "Paid, recorded once, and gone from the shelf.", hold: "" },
];
/** Hero object: one unit moving through the protocol's real states. */
function UnitTicket() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setStep((value) => (value + 1) % STATES.length), 2600);
    return () => clearInterval(timer);
  }, []);
  const state = STATES[step];
  return (
    <figure
      className="ticket"
      aria-label="One tagged unit moving from available to reserved to sold"
    >
      <div className="ticket-top">
        <LogoMark size={20} />
        <code>/u/0198f3a1-7c2e…</code>
      </div>
      <div className="ticket-name">
        <strong>Ceramic pour-over, matte</strong>
        <span>HOME-014-7C2E91AB</span>
      </div>
      <div className="ticket-state" key={state.status}>
        <Status value={state.status} />
        {state.hold && <code>{state.hold}</code>}
        <p>{state.line}</p>
      </div>
      <div className="ticket-rail" aria-hidden="true">
        {STATES.map((value, index) => (
          <span key={value.status} data-on={index <= step} />
        ))}
      </div>
    </figure>
  );
}
const SHOPPERS = 10;
/** Illustrates the guarantee: ten taps, one conditional update, one owner. */
function Race() {
  const [phase, setPhase] = useState<"idle" | "race" | "done">("idle");
  const [winner, setWinner] = useState(3);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = useCallback(() => {
    clearTimeout(timer.current);
    setWinner(Math.floor(Math.random() * SHOPPERS));
    setPhase("idle");
    requestAnimationFrame(() => {
      setPhase("race");
      timer.current = setTimeout(() => setPhase("done"), 850);
    });
  }, []);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("done");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
    };
  }, [run]);
  return (
    <div className="race" ref={box} data-phase={phase}>
      <div className="race-field" aria-hidden="true">
        {Array.from({ length: SHOPPERS }, (_, index) => {
          const angle = (index / SHOPPERS) * Math.PI * 2 - Math.PI / 2;
          return (
            <span
              key={index}
              className={`racer ${index === winner ? "win" : ""}`}
              style={
                {
                  "--x": `${Math.cos(angle) * 44}cqw`,
                  "--y": `${Math.sin(angle) * 44}cqw`,
                  transitionDelay: `${index * 28}ms`,
                } as React.CSSProperties
              }
            />
          );
        })}
        <span className="race-unit">
          <LogoMark size={26} />
        </span>
      </div>
      <div className="race-log" aria-live="polite">
        <code>UPDATE inventory_unit SET status = 'RESERVED'</code>
        <code>WHERE id = $1 AND status = 'AVAILABLE'</code>
        <p>
          {phase === "done"
            ? "1 row updated. Nine shoppers are told the unit is held."
            : "Ten shoppers tap the same unit…"}
        </p>
        <button className="lp-link" onClick={run}>
          <Play size={13} /> Run it again
        </button>
      </div>
    </div>
  );
}
const STEPS = [
  ["Receive", "Every physical unit gets its own UUID and link, separate from its SKU."],
  ["Tag", "Export a manifest for your NFC encoder, or print QR labels from the same list."],
  ["Tap", "A phone opens the link. No app. The shopper reserves the exact item in hand."],
  ["Settle", "Desk or card. The sale is recorded only after the payment is confirmed."],
];
const FEATURES = [
  ["Desk mode", "A live queue of orders waiting on payment, with one action to settle each."],
  ["Unit history", "Every reservation, release, sale and return for one physical item."],
  ["Demand forecasts", "Seven-day estimates and reorder quantities, labelled with confidence."],
  ["Team roles", "Invite managers and staff with a single-use link. Remove them in one click."],
  ["Reports", "Revenue, returns and reservation outcomes against the previous period."],
  ["Command palette", "Press ⌘K to reach any product, order, customer or action."],
];
export function Landing() {
  return (
    <div className="lp">
      <a href="#top" className="skip-link">
        Skip to content
      </a>
      <header className="lp-nav">
        <Link to="/" aria-label="TapCart home">
          <Logo />
        </Link>
        <nav aria-label="Marketing">
          <a href="#how">How it works</a>
          <a href="#protocol">Protocol</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="lp-nav-end">
          <Link to="/login" className="lp-link">
            Sign in
          </Link>
          <Link to="/register" className="button primary">
            Start free
          </Link>
        </div>
      </header>
      <main id="top">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <h1>
              Every item in your store can sell itself.
              <span> Exactly once.</span>
            </h1>
            <p>
              TapCart gives each physical unit its own NFC link. Shoppers tap, hold the exact item
              and check out. Your team sees every unit, and two people can never buy the same one.
            </p>
            <div className="lp-actions">
              <Link to="/register" className="button primary lp-cta">
                Start free
                <ArrowRight size={16} />
              </Link>
              <Link to="/customer" className="button secondary lp-cta">
                See the shopper view
              </Link>
            </div>
          </div>
          <UnitTicket />
        </section>
        <section className="lp-how" id="how">
          <h2>From shelf to sale in four moves.</h2>
          <ol>
            {STEPS.map(([title, detail]) => (
              <li key={title}>
                <strong>{title}</strong>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
        </section>
        <div className="lp-fade" aria-hidden="true">
          <LogoMark size={44} alive />
        </div>
        <div className="lp-black">
          <section className="lp-protocol" id="protocol">
            <div>
              <h2>Built on a protocol, not on hope.</h2>
              <p>
                Reservation, release, expiry, checkout, sale and return are each a conditional
                atomic transition in PostgreSQL. Stock is counted from unit state, so it cannot
                drift. Retries are idempotent, and leases expire on the database clock.
              </p>
              <p className="lp-note">
                The animation illustrates the guarantee. Our test suite races real shoppers against
                a real database and asserts exactly one owner.
              </p>
            </div>
            <Race />
          </section>
          <section className="lp-features">
            <h2>What your team gets on day one.</h2>
            <dl>
              {FEATURES.map(([title, detail]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="lp-pricing" id="pricing">
            <h2>Priced by the size of your floor.</h2>
            <div className="lp-plans">
              {PLANS.map((plan) => (
                <article key={plan.id} data-featured={plan.id === "GROWTH"}>
                  <h3>{plan.name}</h3>
                  <p className="lp-price">
                    <strong>{plan.price}</strong> <span>{plan.cadence}</span>
                  </p>
                  <p>{plan.summary}</p>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <Check size={14} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/register"
                    className={`button ${plan.id === "GROWTH" ? "invert" : "ghost-invert"}`}
                  >
                    {plan.id === "SCALE" ? "Talk to us" : "Start free"}
                  </Link>
                </article>
              ))}
            </div>
            <p className="lp-note">
              Static tags identify a unit. They do not prove a product is genuine. Tag read
              reliability depends on your phones, tags and materials, so test on your own shelf.
            </p>
          </section>
          <footer className="lp-footer">
            <Logo />
            <span>© {new Date().getFullYear()} TapCart</span>
            <nav aria-label="Footer">
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create account</Link>
              <Link to="/customer">Shop</Link>
            </nav>
          </footer>
        </div>
      </main>
    </div>
  );
}
