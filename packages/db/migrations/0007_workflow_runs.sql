CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"task" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_task_key" UNIQUE("org_id","task","idempotency_key"),
	CONSTRAINT "workflow_runs_status" CHECK ("workflow_runs"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;