CREATE TYPE "public"."enrollment_status" AS ENUM('pre_enrolled', 'enrolled', 'left');--> statement-breakpoint
CREATE TYPE "public"."exit_reason" AS ENUM('transfer', 'dropout', 'expulsion');--> statement-breakpoint
CREATE TYPE "public"."validation_mode" AS ENUM('manual', 'payment');--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"class_id" uuid,
	"status" "enrollment_status" DEFAULT 'pre_enrolled' NOT NULL,
	"validation_mode" "validation_mode",
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"entry_date" date NOT NULL,
	"exit_date" date,
	"exit_reason" "exit_reason",
	"exit_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_student_year" UNIQUE("student_id","academic_year_id"),
	CONSTRAINT "enrollments_id_school" UNIQUE("id","school_id"),
	CONSTRAINT "enrollments_validated" CHECK ("enrollments"."status" = 'pre_enrolled' or ("enrollments"."validation_mode" is not null and "enrollments"."validated_at" is not null)),
	CONSTRAINT "enrollments_left" CHECK ("enrollments"."status" <> 'left' or ("enrollments"."exit_date" is not null and "enrollments"."exit_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."students"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_year_fk" FOREIGN KEY ("academic_year_id","school_id") REFERENCES "public"."academic_years"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_level_fk" FOREIGN KEY ("level_id","school_id") REFERENCES "public"."levels"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_fk" FOREIGN KEY ("class_id","academic_year_id","school_id") REFERENCES "public"."classes"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollments_class_idx" ON "enrollments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "enrollments_school_year_idx" ON "enrollments" USING btree ("school_id","academic_year_id");