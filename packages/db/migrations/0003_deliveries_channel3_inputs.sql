CREATE TABLE "channel3_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"credits" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"cart_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'ORDERED' NOT NULL,
	"delivered_at" timestamp with time zone,
	"inspected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_cart_supplier" UNIQUE("cart_id","supplier_id"),
	CONSTRAINT "deliveries_status" CHECK ("deliveries"."status" in ('ORDERED', 'DELIVERED', 'INSPECTED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "inputs" jsonb;--> statement-breakpoint
ALTER TABLE "channel3_calls" ADD CONSTRAINT "channel3_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;