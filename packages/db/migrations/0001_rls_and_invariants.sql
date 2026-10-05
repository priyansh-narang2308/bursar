-- Hand-written: what the schema file cannot say. Tenant isolation, and the rules the database enforces
-- itself, so a bug in application code cannot break them.

-- The role tenant code runs as. It is not a superuser and has no BYPASSRLS, so every policy below applies
-- to it. `withOrg` switches to it for the length of a transaction. System code (migrations, the Verifier,
-- webhook ingest, cron) uses the connection's own role and sees every tenant.
DO $$ BEGIN CREATE ROLE bursar_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
GRANT bursar_app TO CURRENT_USER;
--> statement-breakpoint
-- The organisation of the current transaction, or null if none was set: no organisation sees no rows.
CREATE FUNCTION app_org() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '') $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO bursar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bursar_app;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO bursar_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bursar_app;
--> statement-breakpoint
REVOKE ALL ON webhook_inbox FROM bursar_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON action_transitions FROM bursar_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_events, policy_versions, ledger_entries FROM bursar_app;
--> statement-breakpoint

-- Row-level security on every table that has an org_id. A test fails if a later table with one is missed.
DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO bursar_app USING (org_id = app_org()) WITH CHECK (org_id = app_org())', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_organization ON organizations FOR SELECT TO bursar_app USING (id = app_org());
--> statement-breakpoint
-- People are global, so a tenant sees only the people who are members of its organisation.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY members_only ON users FOR SELECT TO bursar_app USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = app_org())
);
--> statement-breakpoint

-- An action only moves along the legal transitions, which are the table below (`ACTION_TRANSITIONS` in
-- @bursar/schemas; a test keeps the two equal) and starts as PROPOSED.
INSERT INTO action_transitions (from_state, to_state) VALUES
  ('PROPOSED', 'DENIED'), ('PROPOSED', 'AWAITING_APPROVAL'), ('PROPOSED', 'APPROVED'),
  ('AWAITING_APPROVAL', 'APPROVED'), ('AWAITING_APPROVAL', 'REJECTED'), ('AWAITING_APPROVAL', 'EXPIRED'),
  ('APPROVED', 'SUBMITTING'),
  ('SUBMITTING', 'SUBMITTED'), ('SUBMITTING', 'FAILED'), ('SUBMITTING', 'UNKNOWN'), ('SUBMITTING', 'DENIED'),
  ('SUBMITTED', 'CONFIRMED'), ('SUBMITTED', 'INCIDENT'),
  ('UNKNOWN', 'SUBMITTED');
--> statement-breakpoint
CREATE FUNCTION enforce_action_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PROPOSED' THEN
      RAISE EXCEPTION 'An action starts as PROPOSED, not %', NEW.state USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.state <> OLD.state AND NOT EXISTS (
    SELECT 1 FROM action_transitions WHERE from_state = OLD.state AND to_state = NEW.state
  ) THEN
    RAISE EXCEPTION 'An action cannot move from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER actions_state_machine BEFORE INSERT OR UPDATE OF state ON actions
  FOR EACH ROW EXECUTE FUNCTION enforce_action_transition();
--> statement-breakpoint

-- The audit log, the ledger and policy versions are never edited: corrections are new rows.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Double entry: when a transaction commits, each ledger transaction's debits must equal its credits, per
-- currency. Deferred, because the entries of one transaction are inserted one at a time.
CREATE FUNCTION check_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entries WHERE txn_id = NEW.txn_id
    GROUP BY currency
    HAVING sum(CASE side WHEN 'DEBIT' THEN amount_minor ELSE -amount_minor END) <> 0
  ) THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance', NEW.txn_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();
