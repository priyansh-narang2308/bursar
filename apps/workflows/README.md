# @bursar/workflows

Background tasks with a durable, idempotent run record. `startTask(orgId, name, input, key)` runs a task once per key: a repeat returns the stored result, a failed run is retried by exactly one caller, and only crashes and timeouts are retried (a refusal from the core is final).

Tasks: `plan_mission`, `research_need`, `buy`, `execute_action`, `ingest_paypal_event`, `settle_supplier`, `replan_schedule` (a recovery is a new cart sent through the decision pipeline) and, from `labTasks`, `lab_scenario` and `lab_run` (fan-out). `runPipeline` chains plan, research and buy. `reconcileWindow` is a system job: it looks across organisations, so it has no tenant run.

They run in process today. They are plain functions, so a Render Workflow can call the same ones; that adapter and its live check are not built yet.
