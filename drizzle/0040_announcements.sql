CREATE TYPE "public"."announcement_audience" AS ENUM('school', 'level', 'class');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"audience" "announcement_audience" NOT NULL,
	"level_id" uuid,
	"class_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"send_message" boolean NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_audience" CHECK (("announcements"."audience" = 'school' and "announcements"."level_id" is null and "announcements"."class_id" is null)
        or ("announcements"."audience" = 'level' and "announcements"."level_id" is not null and "announcements"."class_id" is null)
        or ("announcements"."audience" = 'class' and "announcements"."class_id" is not null and "announcements"."level_id" is null)),
	CONSTRAINT "announcements_lengths" CHECK (length("announcements"."title") between 1 and 80 and length("announcements"."body") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_year_fk" FOREIGN KEY ("academic_year_id","school_id") REFERENCES "public"."academic_years"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_level_fk" FOREIGN KEY ("level_id","school_id") REFERENCES "public"."levels"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_fk" FOREIGN KEY ("class_id","academic_year_id","school_id") REFERENCES "public"."classes"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_school_idx" ON "announcements" USING btree ("school_id","created_at");