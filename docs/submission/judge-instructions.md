# For judges: try it in one minute

No sign-up, no keys, no real money. Everything runs on PayPal's **sandbox**.

**Open <https://bursar-demo.onrender.com> and choose "Open demo workspace".** A populated workspace opens in a second. Then:

1. **Missions.** Open the mission and choose **Run agents**. The trace shows the Planner, a researcher for each need, and the Buyer proposing one cart. The server prices it; no model names an amount.
2. **Approvals.** Open the cart to read the policy trace, then **Approve**. PayPal places a real sandbox hold.
3. **Open the receipt** from the mission page and choose **Replay**. The ruling reproduces exactly.
4. **Gauntlet.** Run it. Twenty-seven injection payloads are read by a naive agent and by the same agent behind Bursar.
5. **Policy lab.** Pick "Standard, daily limit removed" and run it. It finds the hole, and **Shrink and fix** reduces it to the fewest orders and proposes the patch.
6. **Studio.** Click a rule in the heatmap to narrow the other widgets. Choose **Edit layout** and ask the assistant "How much of the envelope is left?".
7. **Schedule.** Delay the longest delivery and see the plan reflow and a recovery proposed.
8. **Incidents.** Simulate a rogue capture. Do it last: it revokes this workspace's mandate. Open a new workspace to start again.

## What to expect

- **The Policy Lab can take up to a minute** on the deployed site, because it runs real scenarios through the real decision pipeline.
- **A trial notice appears in Studio.** AG Studio runs on a trial licence.
- **The first visit can be slow** if the service has been idle; give it a few seconds.
- **Everything simulated is marked.** Look for the `SIM` badge and the "scripted model" badge. The demo's agents run on a deterministic scripted model so every visit behaves the same; the tools, the policy and the receipts are the real ones.

## What is real, and what is not

| Part | Real | Simulated |
| --- | --- | --- |
| PayPal | Sandbox Vault token, authorization, capture, refund and signed webhooks | The buyer's approval is given in advance from a small pool of sandbox buyers |
| Catalog | Recorded offers from real retailers, re-quoted on every purchase; live Channel3 search is a switch | The default is recorded, to be repeatable |
| Agents | Real tools, real policy path, real receipts | The model is a script |
| Verification | Signature-checked webhooks, reconciliation logic, kill switch | Payouts and Transaction Search were not available on the sandbox app, so they are tested against the fake only |

The full account is in [docs/validation](../validation/README.md) and [docs/threat-model.md](../threat-model.md).
