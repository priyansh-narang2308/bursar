-- A tenant sees only its own runs.
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workflow_runs TO bursar_app USING (org_id = app_org()) WITH CHECK (org_id = app_org());
