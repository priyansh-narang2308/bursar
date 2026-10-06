# @bursar/agent-tools

The tools an LLM agent is given. `createToolbox` returns `definitions()` (for the model) and `call(name, input)`.

- **Contracts** come from `LLM_TOOLS` in `@bursar/schemas`: no amount, currency or payee in any input.
- **Allow-lists** by role: the planner reads, the researcher searches and compares, the buyer proposes a cart. An unknown, disallowed or unbuilt tool is refused with a code the model can read.
- **Untrusted content** (titles, goals) is wrapped by `untrusted()` and cannot close its own fence.
- **Only registered suppliers**: search results from sellers nobody registered are dropped and counted.
- **Re-quoted offers**: `get_offer` takes a live price; if it moved, it stores a new snapshot and says by how much.
- **Policy is summarised without thresholds.**
- `onCall` logs every call: tool, agent, outcome, time.

`get_shortlist`, `request_swap` and `reschedule_task` are not built yet.
