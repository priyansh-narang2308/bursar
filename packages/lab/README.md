# @bursar/lab

The Policy Lab. `generate` makes seeded scenarios from eight families (structuring, slow structuring, splitting across suppliers, duplicate bursts, envelope exhaustion, quantity spikes, item-cap edges, a big first order). `play` runs one against a `LabEnv` (the real pipeline in the tests), and `invariants` judge the result:

- no more than the limit approved without a person in 24 hours,
- approved spending within the mission budget,
- no double approval of the same order,
- no item over the cap approved.

When one breaks: `minimize` shrinks the scenario (delta debugging), `proposePatches` suggests a change to the policy, and `freeze` writes the case to `regressions/*.json`, which the tests replay forever (it must fail under the old policy and hold under the fixed one). Its first find in the standard policy is frozen in `regressions/split-across-suppliers.json`.

`Mutator` is the hook for a model to make scenarios sneakier; the default is deterministic jitter.
