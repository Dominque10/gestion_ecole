CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('absence');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time_slot_id" uuid NOT NULL,
	"class_subject_id" uuid,
	"status" "attendance_status" NOT NULL,
	"recorded_by" uuid NOT NULL,
	"justified" boolean DEFAULT false NOT NULL,
	"justification_reason" text,
	"justification_document_id" uuid,
	"justified_by" uuid,
	"justified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_enrollment_day_slot" UNIQUE("enrollment_id","date","time_slot_id"),
	CONSTRAINT "attendance_justified" CHECK (not "attendance"."justified" or ("attendance"."status" <> 'present' and "attendance"."justification_reason" is not null and "attendance"."justified_by" is not null and "attendance"."justified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"guardian_id" uuid,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"status" "notification_status" NOT NULL,
	"provider_ref" text,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_one_per_day" UNIQUE("enrollment_id","kind","date")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_time_slot_id_time_slots_id_fk" FOREIGN KEY ("time_slot_id") REFERENCES "public"."time_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_class_subject_id_class_subjects_id_fk" FOREIGN KEY ("class_subject_id") REFERENCES "public"."class_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_justification_document_id_student_documents_id_fk" FOREIGN KEY ("justification_document_id") REFERENCES "public"."student_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_justified_by_users_id_fk" FOREIGN KEY ("justified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_enrollment_fk" FOREIGN KEY ("enrollment_id","school_id") REFERENCES "public"."enrollments"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_school_date_idx" ON "attendance" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "notifications_school_idx" ON "notifications" USING btree ("school_id","created_at");