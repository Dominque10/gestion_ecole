ALTER TABLE "periods" ADD CONSTRAINT "periods_id_year_school" UNIQUE("id","academic_year_id","school_id");--> statement-breakpoint
CREATE TYPE "public"."assessment_kind" AS ENUM('quiz', 'homework', 'composition');--> statement-breakpoint
CREATE TYPE "public"."grade_status" AS ENUM('scored', 'absent', 'excused');--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"title" text,
	"date" date NOT NULL,
	"max_score" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_id_year_school" UNIQUE("id","academic_year_id","school_id"),
	CONSTRAINT "assessments_max_score" CHECK ("assessments"."max_score" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"status" "grade_status" NOT NULL,
	"score" numeric(5, 2),
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_assessment_enrollment" UNIQUE("assessment_id","enrollment_id"),
	CONSTRAINT "grades_score_status" CHECK (("grades"."status" = 'scored') = ("grades"."score" is not null) and ("grades"."score" is null or "grades"."score" >= 0))
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_class_fk" FOREIGN KEY ("class_id","academic_year_id","school_id") REFERENCES "public"."classes"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_class_subject_fk" FOREIGN KEY ("class_id","subject_id") REFERENCES "public"."class_subjects"("class_id","subject_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_period_fk" FOREIGN KEY ("period_id","academic_year_id","school_id") REFERENCES "public"."periods"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_assessment_fk" FOREIGN KEY ("assessment_id","academic_year_id","school_id") REFERENCES "public"."assessments"("id","academic_year_id","school_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_class_subject_period_idx" ON "assessments" USING btree ("class_id","subject_id","period_id");--> statement-breakpoint
CREATE INDEX "assessments_school_idx" ON "assessments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "grades_enrollment_idx" ON "grades" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "grades_school_idx" ON "grades" USING btree ("school_id");
