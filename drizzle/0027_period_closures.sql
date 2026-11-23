CREATE TABLE "period_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopen_reason" text,
	CONSTRAINT "period_closures_period_class" UNIQUE("period_id","class_id"),
	CONSTRAINT "period_closures_reopen" CHECK ("period_closures"."closed" or ("period_closures"."reopened_at" is not null and "period_closures"."reopened_by" is not null and "period_closures"."reopen_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "period_closures" ADD CONSTRAINT "period_closures_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closures" ADD CONSTRAINT "period_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closures" ADD CONSTRAINT "period_closures_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closures" ADD CONSTRAINT "period_closures_period_fk" FOREIGN KEY ("period_id","academic_year_id","school_id") REFERENCES "public"."periods"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closures" ADD CONSTRAINT "period_closures_class_fk" FOREIGN KEY ("class_id","academic_year_id","school_id") REFERENCES "public"."classes"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_closures_school_idx" ON "period_closures" USING btree ("school_id");