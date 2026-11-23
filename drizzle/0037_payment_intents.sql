CREATE TYPE "public"."payment_intent_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."mobile_operator" AS ENUM('airtel', 'mtn');--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"invoice_ids" uuid[] NOT NULL,
	"amount" integer NOT NULL,
	"phone" text NOT NULL,
	"operator" "mobile_operator" NOT NULL,
	"status" "payment_intent_status" DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"operator_ref" text,
	"payment_id" uuid,
	"failure_reason" text,
	"created_by" uuid NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_provider_ref" UNIQUE("provider","provider_ref"),
	CONSTRAINT "payment_intents_payment" UNIQUE("payment_id"),
	CONSTRAINT "payment_intents_amount" CHECK ("payment_intents"."amount" between 1 and 100000000),
	CONSTRAINT "payment_intents_succeeded" CHECK (("payment_intents"."status" = 'succeeded') = ("payment_intents"."payment_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_intents_school_idx" ON "payment_intents" USING btree ("school_id","created_at");