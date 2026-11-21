CREATE TYPE "public"."academic_year_status" AS ENUM('upcoming', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('trimester', 'semester');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"period_kind" "period_kind" DEFAULT 'trimester' NOT NULL,
	"status" "academic_year_status" DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_years_school_label" UNIQUE("school_id","label"),
	CONSTRAINT "academic_years_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "academic_years_dates" CHECK ("academic_years"."start_date" < "academic_years"."end_date")
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_year_position" UNIQUE("academic_year_id","position"),
	CONSTRAINT "periods_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "periods_position" CHECK ("periods"."position" >= 1),
	CONSTRAINT "periods_dates" CHECK ("periods"."start_date" <= "periods"."end_date")
);
--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_year_fk" FOREIGN KEY ("academic_year_id","school_id") REFERENCES "public"."academic_years"("id","school_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_one_active" ON "academic_years" USING btree ("school_id") WHERE "academic_years"."status" = 'active';--> statement-breakpoint
CREATE INDEX "periods_school_idx" ON "periods" USING btree ("school_id");