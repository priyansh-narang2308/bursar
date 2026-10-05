CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_id_shape" CHECK ("agents"."id" ~ '^agt_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "agents_status" CHECK ("agents"."status" in ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_hash" CHECK ("api_keys"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "cart_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"cart_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"rationale" text,
	CONSTRAINT "cart_lines_id_shape" CHECK ("cart_lines"."id" ~ '^cln_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "cart_lines_quantity" CHECK ("cart_lines"."quantity" between 1 and 99),
	CONSTRAINT "cart_lines_total" CHECK ("cart_lines"."line_total_minor" = "cart_lines"."unit_price_minor" * "cart_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"version" integer NOT NULL,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"cart_hash" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_version_unique" UNIQUE("mission_id","version"),
	CONSTRAINT "carts_id_shape" CHECK ("carts"."id" ~ '^crt_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "carts_status" CHECK ("carts"."status" in ('DRAFT', 'PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
	CONSTRAINT "carts_currency" CHECK ("carts"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "carts_hash" CHECK ("carts"."cart_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "carts_version" CHECK ("carts"."version" >= 1 and "carts"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"policy_set_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"currency" text NOT NULL,
	"cap_minor" bigint NOT NULL,
	"per_mission_cap_minor" bigint NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"vault_token_sealed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_id_shape" CHECK ("mandates"."id" ~ '^mnd_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "mandates_status" CHECK ("mandates"."status" in ('PENDING', 'ACTIVE', 'FROZEN', 'REVOKED', 'EXPIRED')),
	CONSTRAINT "mandates_currency" CHECK ("mandates"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "mandates_caps" CHECK ("mandates"."per_mission_cap_minor" between 0 and "mandates"."cap_minor"),
	CONSTRAINT "mandates_window" CHECK ("mandates"."valid_to" > "mandates"."valid_from"),
	CONSTRAINT "mandates_revoked" CHECK (("mandates"."status" = 'REVOKED') = ("mandates"."revoked_at" is not null)),
	CONSTRAINT "mandates_signed" CHECK ("mandates"."status" not in ('ACTIVE', 'FROZEN') or "mandates"."signed_at" is not null),
	CONSTRAINT "mandates_sealed" CHECK ("mandates"."vault_token_sealed" is null or "mandates"."vault_token_sealed" like 'bursar:secret:v1:%')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "memberships_role" CHECK ("memberships"."role" in ('OWNER', 'APPROVER', 'OPERATOR', 'AUDITOR', 'AGENT', 'VERIFIER'))
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mandate_id" text,
	"envelope_id" text,
	"goal" text NOT NULL,
	"deadline" timestamp with time zone,
	"currency" text NOT NULL,
	"budget_minor" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_id_shape" CHECK ("missions"."id" ~ '^mis_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "missions_status" CHECK ("missions"."status" in ('DRAFT', 'PLANNING', 'AWAITING_APPROVAL', 'ACTIVE', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED', 'FAILED')),
	CONSTRAINT "missions_currency" CHECK ("missions"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "missions_budget" CHECK ("missions"."budget_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"category" text NOT NULL,
	"image_url" text,
	"url" text NOT NULL,
	"currency" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"availability" text NOT NULL,
	"source" text NOT NULL,
	"quote_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_id_shape" CHECK ("offers"."id" ~ '^ofr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "offers_currency" CHECK ("offers"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "offers_price" CHECK ("offers"."price_minor" >= 0),
	CONSTRAINT "offers_availability" CHECK ("offers"."availability" in ('IN_STOCK', 'LIMITED', 'OUT_OF_STOCK', 'UNKNOWN')),
	CONSTRAINT "offers_source" CHECK ("offers"."source" in ('SEARCH', 'DETAIL'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_id_shape" CHECK ("organizations"."id" ~ '^org_[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"paypal_payer_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payers_paypal_unique" UNIQUE("org_id","paypal_payer_id"),
	CONSTRAINT "payers_id_shape" CHECK ("payers"."id" ~ '^pyr_[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);
--> statement-breakpoint
CREATE TABLE "policy_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_sets_id_shape" CHECK ("policy_sets"."id" ~ '^pls_[0-7][0-9A-HJKMNP-TV-Z]{25}$')
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"policy_set_id" text NOT NULL,
	"version" integer NOT NULL,
	"hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_number" UNIQUE("policy_set_id","version"),
	CONSTRAINT "policy_versions_id_shape" CHECK ("policy_versions"."id" ~ '^plv_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "policy_versions_hash" CHECK ("policy_versions"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "policy_versions_version" CHECK ("policy_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"payout_email" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_id_shape" CHECK ("suppliers"."id" ~ '^sup_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "suppliers_status" CHECK ("suppliers"."status" in ('ACTIVE', 'BLOCKED'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_id_shape" CHECK ("users"."id" ~ '^usr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "action_transitions" (
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	CONSTRAINT "action_transitions_from_state_to_state_pk" PRIMARY KEY("from_state","to_state"),
	CONSTRAINT "action_transitions_from" CHECK ("action_transitions"."from_state" in ('PROPOSED', 'DENIED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'UNKNOWN', 'CONFIRMED', 'INCIDENT')),
	CONSTRAINT "action_transitions_to" CHECK ("action_transitions"."to_state" in ('PROPOSED', 'DENIED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'UNKNOWN', 'CONFIRMED', 'INCIDENT'))
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mission_id" text,
	"mandate_id" text,
	"type" text NOT NULL,
	"currency" text,
	"amount_minor" bigint,
	"supplier_id" text,
	"cart_id" text,
	"cart_hash" text,
	"proposed_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'PROPOSED' NOT NULL,
	"compensates_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "actions_id_shape" CHECK ("actions"."id" ~ '^act_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "actions_type" CHECK ("actions"."type" in ('AUTHORIZE', 'CAPTURE', 'VOID', 'REFUND', 'REAUTHORIZE', 'PAYOUT', 'FREEZE', 'REVOKE')),
	CONSTRAINT "actions_state" CHECK ("actions"."state" in ('PROPOSED', 'DENIED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUBMITTING', 'SUBMITTED', 'FAILED', 'UNKNOWN', 'CONFIRMED', 'INCIDENT')),
	CONSTRAINT "actions_proposed_by" CHECK ("actions"."proposed_by" in ('USER', 'AGENT', 'VERIFIER', 'SYSTEM')),
	CONSTRAINT "actions_key" CHECK ("actions"."idempotency_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "actions_amount" CHECK (("actions"."amount_minor" is null) = ("actions"."currency" is null)),
	CONSTRAINT "actions_currency" CHECK ("actions"."currency" is null or "actions"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "actions_non_negative" CHECK ("actions"."amount_minor" is null or "actions"."amount_minor" >= 0),
	CONSTRAINT "actions_moves_money" CHECK ("actions"."type" not in ('AUTHORIZE', 'CAPTURE', 'REFUND', 'PAYOUT') or "actions"."amount_minor" is not null),
	CONSTRAINT "actions_moves_none" CHECK ("actions"."type" not in ('FREEZE', 'REVOKE') or "actions"."amount_minor" is null),
	CONSTRAINT "actions_payout_supplier" CHECK (("actions"."type" = 'PAYOUT') = ("actions"."supplier_id" is not null)),
	CONSTRAINT "actions_cart_hash" CHECK (("actions"."cart_id" is null) = ("actions"."cart_hash" is null)),
	CONSTRAINT "actions_mandate" CHECK ("actions"."type" not in ('FREEZE', 'REVOKE') or "actions"."mandate_id" is not null),
	CONSTRAINT "actions_undoes" CHECK ("actions"."compensates_action_id" is null or "actions"."type" in ('VOID', 'REFUND')),
	CONSTRAINT "actions_verifier_never_spends" CHECK ("actions"."proposed_by" <> 'VERIFIER' or "actions"."type" in ('FREEZE', 'VOID', 'REFUND', 'REVOKE')),
	CONSTRAINT "actions_times" CHECK ("actions"."updated_at" >= "actions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"approver_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"cart_hash" text NOT NULL,
	"policy_hash" text NOT NULL,
	"signature" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approvals_id_shape" CHECK ("approvals"."id" ~ '^apv_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "approvals_status" CHECK ("approvals"."status" in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
	CONSTRAINT "approvals_hashes" CHECK ("approvals"."cart_hash" ~ '^[0-9a-f]{64}$' and "approvals"."policy_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "approvals_signed" CHECK (("approvals"."status" = 'APPROVED') = ("approvals"."signature" is not null)),
	CONSTRAINT "approvals_decided" CHECK (("approvals"."status" in ('APPROVED', 'REJECTED')) = ("approvals"."decided_at" is not null)),
	CONSTRAINT "approvals_who" CHECK ("approvals"."decided_at" is null or "approvals"."approver_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ts" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_seq_unique" UNIQUE("org_id","seq"),
	CONSTRAINT "audit_events_no_fork" UNIQUE("org_id","prev_hash"),
	CONSTRAINT "audit_events_id_shape" CHECK ("audit_events"."id" ~ '^aud_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "audit_events_seq" CHECK ("audit_events"."seq" >= 1),
	CONSTRAINT "audit_events_ts" CHECK ("audit_events"."ts" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'),
	CONSTRAINT "audit_events_actor" CHECK ("audit_events"."actor_kind" in ('USER', 'AGENT', 'VERIFIER', 'SYSTEM')),
	CONSTRAINT "audit_events_type" CHECK ("audit_events"."type" ~ '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$'),
	CONSTRAINT "audit_events_hashes" CHECK ("audit_events"."prev_hash" ~ '^[0-9a-f]{64}$' and "audit_events"."hash" ~ '^[0-9a-f]{64}$' and "audit_events"."prev_hash" <> "audit_events"."hash")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"action_id" text NOT NULL,
	"policy_version_id" text NOT NULL,
	"policy_hash" text NOT NULL,
	"phase" text NOT NULL,
	"outcome" text NOT NULL,
	"required_approvals" integer NOT NULL,
	"trace" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decisions_id_shape" CHECK ("decisions"."id" ~ '^dec_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "decisions_phase" CHECK ("decisions"."phase" in ('PROPOSE', 'EXECUTE')),
	CONSTRAINT "decisions_outcome" CHECK ("decisions"."outcome" in ('ALLOW', 'REQUIRE_APPROVAL', 'DENY')),
	CONSTRAINT "decisions_hashes" CHECK ("decisions"."policy_hash" ~ '^[0-9a-f]{64}$' and "decisions"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "decisions_approvals" CHECK (("decisions"."outcome" = 'REQUIRE_APPROVAL') = ("decisions"."required_approvals" > 0) and "decisions"."required_approvals" <= 2)
);
--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"mandate_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"currency" text NOT NULL,
	"ceiling_minor" bigint NOT NULL,
	"held_minor" bigint DEFAULT 0 NOT NULL,
	"captured_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"settled_minor" bigint DEFAULT 0 NOT NULL,
	"paypal_authorization_id" text,
	"authorization_expires_at" timestamp with time zone,
	"reauthorized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelopes_id_shape" CHECK ("envelopes"."id" ~ '^env_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "envelopes_status" CHECK ("envelopes"."status" in ('PENDING', 'ACTIVE', 'CLOSED', 'VOIDED', 'EXPIRED')),
	CONSTRAINT "envelopes_currency" CHECK ("envelopes"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "envelopes_non_negative" CHECK (least("envelopes"."ceiling_minor", "envelopes"."held_minor", "envelopes"."captured_minor", "envelopes"."refunded_minor", "envelopes"."settled_minor") >= 0),
	CONSTRAINT "envelopes_never_overspent" CHECK ("envelopes"."captured_minor" + "envelopes"."held_minor" <= "envelopes"."ceiling_minor")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"action_id" text NOT NULL,
	"step" text NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'CLAIMED' NOT NULL,
	"paypal_resource_id" text,
	"debug_id" text,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "executions_step_unique" UNIQUE("action_id","step"),
	CONSTRAINT "executions_status" CHECK ("executions"."status" in ('CLAIMED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"auto_response" jsonb DEFAULT '[]' NOT NULL,
	"resolution" jsonb,
	CONSTRAINT "incidents_id_shape" CHECK ("incidents"."id" ~ '^inc_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "incidents_type" CHECK ("incidents"."type" in ('UNEXPLAINED_MOVEMENT', 'AMOUNT_MISMATCH', 'RECONCILIATION_GAP', 'WEBHOOK_VERIFICATION_FAILED', 'DISPUTE_OPENED', 'UNKNOWN_OUTCOME', 'HASH_CHAIN_BROKEN')),
	CONSTRAINT "incidents_severity" CHECK ("incidents"."severity" in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
	CONSTRAINT "incidents_status" CHECK ("incidents"."status" in ('OPEN', 'CONTAINED', 'RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"txn_id" uuid NOT NULL,
	"action_id" text,
	"account" text NOT NULL,
	"side" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_side" CHECK ("ledger_entries"."side" in ('DEBIT', 'CREDIT')),
	CONSTRAINT "ledger_entries_currency" CHECK ("ledger_entries"."currency" in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RUB', 'SEK', 'SGD', 'THB', 'TWD', 'USD')),
	CONSTRAINT "ledger_entries_positive" CHECK ("ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paypal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"custom_id" text,
	"invoice_id" text,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"match_status" text DEFAULT 'PENDING' NOT NULL,
	"matched_action_id" text,
	"latency_ms" integer,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "paypal_events_id_shape" CHECK ("paypal_events"."id" ~ '^ppe_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
	CONSTRAINT "paypal_events_verification" CHECK ("paypal_events"."verification_status" in ('PENDING', 'SUCCESS', 'FAILURE')),
	CONSTRAINT "paypal_events_match" CHECK ("paypal_events"."match_status" in ('PENDING', 'MATCHED', 'UNMATCHED', 'EARLY', 'MISMATCH'))
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"headers" jsonb NOT NULL,
	"raw_body" text NOT NULL,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_inbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "webhook_inbox_verification" CHECK ("webhook_inbox"."verification_status" in ('PENDING', 'SUCCESS', 'FAILURE'))
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_policy_set_id_policy_sets_id_fk" FOREIGN KEY ("policy_set_id") REFERENCES "public"."policy_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payers" ADD CONSTRAINT "payers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_sets" ADD CONSTRAINT "policy_sets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_set_id_policy_sets_id_fk" FOREIGN KEY ("policy_set_id") REFERENCES "public"."policy_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_compensates_action_id_actions_id_fk" FOREIGN KEY ("compensates_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_events" ADD CONSTRAINT "paypal_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_events" ADD CONSTRAINT "paypal_events_matched_action_id_actions_id_fk" FOREIGN KEY ("matched_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_txn" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "paypal_events_resource" ON "paypal_events" USING btree ("resource_id");