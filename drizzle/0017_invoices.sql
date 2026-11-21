CREATE TYPE "public"."invoice_status" AS ENUM('open', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"fee_name" text NOT NULL,
	"kind" "fee_kind" NOT NULL,
	"mandatory" boolean NOT NULL,
	"installment_number" integer NOT NULL,
	"installment_count" integer NOT NULL,
	"amount" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"discount_note" text,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_unique" UNIQUE("enrollment_id","fee_name","installment_number"),
	CONSTRAINT "invoices_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "invoices_amount" CHECK ("invoices"."amount" between 1 and 100000000),
	CONSTRAINT "invoices_discount" CHECK ("invoices"."discount_amount" between 0 and "invoices"."amount"),
	CONSTRAINT "invoices_installment" CHECK ("invoices"."installment_number" between 1 and "invoices"."installment_count"),
	CONSTRAINT "invoices_cancelled" CHECK ("invoices"."status" <> 'cancelled' or ("invoices"."cancelled_at" is not null and "invoices"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "sibling_discount_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_id_year_school" UNIQUE("id","academic_year_id","school_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_enrollment_idx" ON "invoices" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "invoices_school_due_idx" ON "invoices" USING btree ("school_id","due_date");