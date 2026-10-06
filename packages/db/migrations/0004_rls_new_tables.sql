-- The tables added since the first RLS migration get the same rule: a tenant sees only its own rows.
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deliveries TO bursar_app USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
ALTER TABLE channel3_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON channel3_calls TO bursar_app USING (org_id = app_org()) WITH CHECK (org_id = app_org());
