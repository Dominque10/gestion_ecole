CREATE TYPE "public"."fee_kind" AS ENUM('registration', 'tuition', 'other');--> statement-breakpoint
CREATE TABLE "fee_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"kind" "fee_kind" NOT NULL,
	"name" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"installment_number" integer NOT NULL,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_items_unique" UNIQUE("academic_year_id","level_id","name","installment_number"),
	CONSTRAINT "fee_items_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "fee_items_installment" CHECK ("fee_items"."installment_number" between 1 and 12),
	CONSTRAINT "fee_items_amount" CHECK ("fee_items"."amount" between 1 and 100000000)
);
--> statement-breakpoint
CREATE TABLE "time_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"label" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_slots_school_label" UNIQUE("school_id","label"),
	CONSTRAINT "time_slots_times" CHECK ("time_slots"."start_time" < "time_slots"."end_time")
);
--> statement-breakpoint
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_year_fk" FOREIGN KEY ("academic_year_id","school_id") REFERENCES "public"."academic_years"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_level_fk" FOREIGN KEY ("level_id","school_id") REFERENCES "public"."levels"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_items_school_idx" ON "fee_items" USING btree ("school_id");