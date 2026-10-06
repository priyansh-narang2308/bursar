import { Link } from 'react-router-dom';
import { Badge, Logo, StateLadder } from '../components/ui';
import { useMe } from '../lib/queries';
import { OpenDemoButton } from '../lib/session';

const STEPS = [
  {
    n: '01',
    title: 'Govern',
    text: 'You sign a mandate: a cap, a per-mission cap and dates. It is tied to the buyer’s PayPal approval and can be frozen or revoked in one click.',
  },
  {
    n: '02',
    title: 'Bind',
    text: 'Agents only ever propose. A deterministic policy engine decides. No amount, price or payee is ever taken from a model.',
  },
  {
    n: '03',
    title: 'Verify',
    text: 'Every movement of money must be confirmed by a signed PayPal webhook that traces back to an approved action. Anything else is an incident.',
  },
  {
    n: '04',
    title: 'Prove',
    text: 'Each action has a receipt: the rules that ran, who approved, what was sent to PayPal, and a tamper-evident audit trail.',
  },
];

const GUARANTEES = [
  [
    'A model never names an amount',
    'Tools take offer ids and quantities. Prices and totals are recomputed on the server from stored snapshots.',
  ],
  [
    'Policy is code, not a prompt',
    'Seventeen pure rules, versioned and replayable. The same inputs give the same ruling, byte for byte.',
  ],
  [
    'An independent verifier',
    'Money that moves with no approved action freezes the mandate, voids holds and refunds the capture.',
  ],
  [
    'A seatbelt for PayPal’s MCP',
    'Agents get Bursar’s guarded tools. PayPal’s own money tools are redirected, and everything else is blocked by default.',
  ],
  [
    'Tested like an attacker would',
    'A policy lab invents adversarial spending patterns, shrinks what breaks, and freezes the fix as a regression.',
  ],
  [
    'Receipts you can replay',
    'Open any ruling and run it again against the policy version it was made under.',
  ],
];

function Preview() {
  const rows: [string, string, 'ok' | 'warn'][] = [
    ['R-MANDATE', 'The mandate is active and in date.', 'ok'],
    ['R-ITEM-CAP', 'No line costs more than $500.00.', 'ok'],
    ['R-VELOCITY', 'Buying is within the rolling limits.', 'ok'],
    ['R-NEW-VENDOR', 'First order from this supplier.', 'warn'],
  ];
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview-bar">
        <span className="mono">act_01M4…7XQ · AUTHORIZE</span>
        <Badge tone="warn">Awaiting approval</Badge>
      </div>
      <div style={{ padding: '14px 12px 10px', display: 'grid', gap: 8 }}>
        <div className="row-between">
          <span className="stat-value num">$635.00</span>
          <span className="faint">desk, chair, monitor, keyboard · shop.example</span>
        </div>
        <StateLadder state="AWAITING_APPROVAL" />
      </div>
      {rows.map(([rule, message, tone]) => (
        <div key={rule} className="trace-line">
          <span className="mono muted">{rule}</span>
          <span className="muted">{message}</span>
          <Badge tone={tone}>{tone === 'ok' ? 'Allow' : 'Approve'}</Badge>
        </div>
      ))}
    </div>
  );
}

export function Landing() {
  const me = useMe();
  const signedIn = me.isSuccess;
  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link to="/" className="brand" style={{ padding: 0 }}>
            <Logo /> Bursar
          </Link>
          <nav className="site-links" aria-label="Site">
            <a href="#how">How it works</a>
            <a href="#guarantees">Guarantees</a>
            {signedIn ? (
              <Link to="/dashboard" className="btn btn-primary">
                Dashboard
              </Link>
            ) : (
              <OpenDemoButton size="md" label="Open demo workspace" />
            )}
          </nav>
        </div>
      </header>

      <main className="wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">Spend control for AI agents</span>
            <h1 style={{ marginTop: 14 }}>Let agents spend. Keep the control.</h1>
            <p className="hero-lede">
              Bursar sits between your AI agents and PayPal. Agents propose, a deterministic policy
              decides, and every cent is confirmed independently and written to a receipt you can
              replay.
            </p>
            <div className="hero-actions">
              {signedIn ? (
                <Link to="/dashboard" className="btn btn-primary btn-lg">
                  Go to dashboard
                </Link>
              ) : (
                <OpenDemoButton />
              )}
              <a href="#how" className="btn btn-lg">
                How it works
              </a>
            </div>
            <p className="hero-note">
              No sign-up. A populated workspace opens in a second, on PayPal’s sandbox.
            </p>
          </div>
          <Preview />
        </section>

        <section className="section" id="how">
          <span className="eyebrow">How it works</span>
          <h2 style={{ marginTop: 12 }}>Four steps between an agent’s idea and your money.</h2>
          <div className="steps">
            {STEPS.map((s) => (
              <div key={s.n} className="step">
                <span className="eyebrow">{s.n}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="guarantees">
          <span className="eyebrow">Guarantees</span>
          <h2 style={{ marginTop: 12 }}>What holds even when the model doesn’t.</h2>
          <div className="guarantees">
            {GUARANTEES.map(([title, text]) => (
              <div key={title} className="guarantee">
                <strong>{title}</strong>
                <span className="muted">{text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="row-between">
            <div>
              <h2>See it work on a real workspace.</h2>
              <p className="section-lede">
                Run the agents, approve a purchase, freeze everything, read the receipt.
              </p>
            </div>
            {signedIn ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Go to dashboard
              </Link>
            ) : (
              <OpenDemoButton />
            )}
          </div>
        </section>
      </main>

      <footer className="wrap site-foot">
        <div className="row-between">
          <span>Bursar · built for the PayPal AI Hackathon</span>
          <span>Sandbox only. No real money moves.</span>
        </div>
      </footer>
    </div>
  );
}
