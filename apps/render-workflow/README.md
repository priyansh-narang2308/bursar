# @bursar/render-workflow

Bursar's mission pipeline as a [Render Workflow](https://render.com/docs/workflows): `run_mission` plans a goal, runs one `research_need` per need **in parallel, each on its own instance**, then `buy_cart` proposes one cart. The logic is in `src/tasks.ts` (plain functions, tested); `src/main.ts` registers them with Render.

## Create the Workflow service (once, in the dashboard)

Render Workflows are created in the dashboard; Blueprints do not support them yet.

1. Open https://dashboard.render.com, then **New**, then **Workflow**.
2. Connect the GitHub repository `priyansh-narang2308/bursar`, branch `main`.
3. **Name** it `bursar` (the slug must be `bursar`; it is `RENDER_WORKFLOW_SLUG` in `.env`).
4. **Root Directory:** leave empty (the repo root, so the workspace packages resolve).
5. **Language:** Node. **Build Command:** `pnpm install --frozen-lockfile`. **Start Command:** `pnpm --filter @bursar/render-workflow start`.
6. **Environment variables** (the same values as the `bursar-demo` web service; copy them from it):
   `BURSAR_DATABASE_URL`, `VAULT_ENC_KEY`, `PROVENANCE_HMAC_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `NODE_VERSION=24`.
   Optional: `BURSAR_CATALOG=live` and `CHANNEL3_API_KEY` to search Channel3 live instead of the recorded products.
7. Click **Deploy Workflow**. When it is live, open it and check that `run_mission`, `plan_mission`, `research_need` and `buy_cart` are listed.
8. On the `bursar-demo` web service add `BURSAR_WORKFLOWS=render` and `RENDER_WORKFLOW_SLUG=bursar` (`RENDER_API_KEY` is already there), then redeploy it.

After that, **Run agents** on a mission shows the badge "Ran on a Render Workflow". If the workflow is unavailable the mission runs on the server and the badge is absent.

## Locally

```bash
pnpm --filter @bursar/render-workflow test
```
