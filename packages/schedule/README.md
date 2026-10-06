# @bursar/schedule

Delivery plans as pure functions of their input. Tasks take whole days and wait for other tasks (plus an optional lag).

- `schedule(tasks, { deadline })`: forward and backward pass, slack per task, the critical path, and days to spare against the deadline (negative if missed).
- `diff(baseline, current)`: what moved, and what became late.
- `planFromBasket(lines)`: each line is delivered, then inspected; the handover waits for all of them.
- `applyEvent(tasks, event)`: a carrier event (delay or early) from the simulator.
- `replan(tasks, event, { deadline, alternatives })`: the fewest swaps to faster alternatives that bring the plan back on time, or `recovered: null`.

It proposes nothing itself: `@bursar/workflows` turns a recovery into a cart and sends it through the decision pipeline.
