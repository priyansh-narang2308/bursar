# @bursar/agents

`runMission(deps)`: the Planner turns the mission's goal into needs, a Researcher per need searches and picks one offer (in parallel), and the Buyer proposes one cart. None of them states a price, a total or a payee. A pick must name an offer the search returned.

`@bursar/agents/eval` scores the agents on ten goals (constraints met, cost against budget, in-stock rate, valid citations, steps, tokens) with `heuristicModel`, a scripted stand-in that follows the real protocol. It tests the harness and the guards, not Claude; a live run needs an Anthropic key.

`injection.ts` holds 27 prompt-injection payloads across nine families and one gullible scripted model. Run against raw tools it pays or orders for the attacker on 24 of 27; run against the guarded toolbox the same model makes no PayPal call on any. Only the tool layer differs, so the guard is what holds.
