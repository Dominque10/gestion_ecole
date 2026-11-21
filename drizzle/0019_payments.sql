CREATE TYPE "public"."cancellation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'mobile_money', 'transfer', 'cheque');--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "payment_allocations_unique" UNIQUE("payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount" CHECK ("payment_allocations"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "payment_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "cancellation_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reversal_id" uuid,
	CONSTRAINT "payment_cancellations_decided" CHECK ("payment_cancellations"."status" = 'pending' or ("payment_cancellations"."decided_by" is not null and "payment_cancellations"."decided_at" is not null)),
	CONSTRAINT "payment_cancellations_approved" CHECK ("payment_cancellations"."status" <> 'approved' or "payment_cancellations"."reversal_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'payment' NOT NULL,
	"amount" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"receipt_number" text,
	"reverses_id" uuid,
	"cashier_id" uuid NOT NULL,
	"note" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_receipt" UNIQUE("school_id","receipt_number"),
	CONSTRAINT "payments_reverses" UNIQUE("reverses_id"),
	CONSTRAINT "payments_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "payments_kind" CHECK (("payments"."kind" = 'payment' and "payments"."amount" between 1 and 100000000 and "payments"."receipt_number" is not null and "payments"."reverses_id" is null)
        or ("payments"."kind" = 'reversal' and "payments"."amount" < 0 and "payments"."receipt_number" is null and "payments"."reverses_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "academic_years" ADD COLUMN "last_receipt_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."payments"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_fk" FOREIGN KEY ("invoice_id","school_id") REFERENCES "public"."invoices"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellations" ADD CONSTRAINT "payment_cancellations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellations" ADD CONSTRAINT "payment_cancellations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellations" ADD CONSTRAINT "payment_cancellations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellations" ADD CONSTRAINT "payment_cancellations_reversal_id_payments_id_fk" FOREIGN KEY ("reversal_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cancellations" ADD CONSTRAINT "payment_cancellations_payment_fk" FOREIGN KEY ("payment_id","school_id") REFERENCES "public"."payments"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_id_payments_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_cancellations_one_pending" ON "payment_cancellations" USING btree ("payment_id") WHERE "payment_cancellations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_cancellations_school_idx" ON "payment_cancellations" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference" ON "payments" USING btree ("school_id","method","reference") WHERE "payments"."reference" is not null and "payments"."kind" = 'payment';--> statement-breakpoint
CREATE INDEX "payments_enrollment_idx" ON "payments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "payments_school_paid_idx" ON "payments" USING btree ("school_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_cashier_paid_idx" ON "payments" USING btree ("cashier_id","paid_at");