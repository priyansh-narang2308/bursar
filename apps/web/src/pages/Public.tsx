import { PublicPage, REPO_URL } from '../components/Site';

export function Security() {
  return (
    <PublicPage
      eyebrow="Security"
      title="How Bursar keeps agents from moving the wrong money"
      lede="The design assumes the model can be fooled and the network can be hostile. These are the controls that hold anyway, and where to find the tests that prove each one."
    >
      <h2>Models never name money</h2>
      <p>
        Tools an agent can call carry no amount, payee or currency. A guard test fails the build if
        one gains such a field. Totals are recomputed on the server from stored snapshots, and
        catalog prices are re-quoted before buying, so a poisoned product title has nothing to
        change.
      </p>
      <h2>Policy is code</h2>
      <p>
        Seventeen pure rules decide every cart. They are deterministic, versioned, fail closed and
        replayable: open any receipt and run the ruling again under the policy version it was made
        under. Policy is evaluated again at execution time, so a stale decision cannot spend.
      </p>
      <h2>Money is bound to PayPal</h2>
      <ul>
        <li>A mandate is a PayPal Vault token and a mission is a PayPal authorization.</li>
        <li>
          Every PayPal call carries a request id derived from the action, so a retry cannot pay
          twice.
        </li>
        <li>
          Webhooks are verified with PayPal before they are trusted and de-duplicated by event id.
        </li>
        <li>
          Anything that moves money with no approved action is an incident that freezes the mandate.
        </li>
      </ul>
      <h2>Separation of duties</h2>
      <p>
        Approvals are signed over the cart hash, and the person or agent that proposed an action can
        never approve it. Changing what a hash covers changes what old approvals mean, so it needs a
        recorded decision.
      </p>
      <h2>Data and secrets</h2>
      <ul>
        <li>
          Every tenant table is protected by row-level security, and a test fails if one is not.
        </li>
        <li>
          Hashing, signing, sealing and comparison go through a single crypto package, with one key
          per purpose.
        </li>
        <li>
          The audit log is append-only and hash-chained, and can be verified from the dashboard.
        </li>
        <li>No secrets are committed, and every push is scanned for them.</li>
      </ul>
      <h2>The web edge</h2>
      <p>
        Writes must come from the app's own origin, request bodies are size-limited, requests are
        rate limited, and tokens are compared in constant time. The scheduled-job door is closed
        unless a secret is configured.
      </p>
      <h2>Sandbox only</h2>
      <p>
        The PayPal base URL is asserted at startup and live mode is refused. This demo cannot move
        real money. Read the <a href={`${REPO_URL}/blob/main/AGENTS.md`}>engineering rules</a> or
        the <a href={`${REPO_URL}/tree/main/docs/decisions`}>decision records</a> for the reasoning.
      </p>
    </PublicPage>
  );
}

export function Limits() {
  return (
    <PublicPage
      eyebrow="Limits"
      title="What this demo is, and what it is not"
      lede="Bursar is a hackathon project that runs on PayPal's sandbox. This page says plainly where the demo stands in for the real thing."
    >
      <h2>Sandbox money only</h2>
      <p>
        Every payment, hold, capture and refund happens on PayPal's sandbox. There is no live mode,
        and none is planned for this submission.
      </p>
      <h2>A pool of pre-approved buyers</h2>
      <p>
        A real buyer approves a PayPal payment method once. So that the public demo works in a
        second, workspaces draw on a small pool of sandbox buyers who approved earlier. Revoking a
        workspace's mandate never deletes a pooled buyer's token.
      </p>
      <h2>A scripted model drives the agents</h2>
      <p>
        The demo's Planner, Researcher and Buyer run on a deterministic scripted model, so every
        visit behaves the same and costs nothing. The tools, the policy path and the receipts are
        the real ones. The Claude client, with budgets and record and replay, is built and tested
        but is not called by the demo server yet.
      </p>
      <h2>The catalog</h2>
      <p>
        By default the demo searches recorded product data from real retailers. A live Channel3
        search can be switched on, and prices are always re-quoted before buying.
      </p>
      <h2>Shared, disposable workspaces</h2>
      <p>
        Demo workspaces are throwaway and may be reset. Do not enter anything you want to keep, and
        do not enter real payment details anywhere.
      </p>
      <h2>Not built yet</h2>
      <ul>
        <li>
          Browser end-to-end and visual regression suites run in development, not in the public
          demo.
        </li>
        <li>
          The schedule chart is read only. Changing a delivery goes through a proposal, not a drag.
        </li>
      </ul>
    </PublicPage>
  );
}
