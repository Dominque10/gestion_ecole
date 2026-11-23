CREATE TYPE "public"."council_decision" AS ENUM('promoted', 'repeat', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."report_card_kind" AS ENUM('period', 'annual');--> statement-breakpoint
CREATE TABLE "report_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" "report_card_kind" NOT NULL,
	"period_id" uuid,
	"subject_comments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"general_comment" text,
	"general_comment_by" uuid,
	"mention" text,
	"decision" "council_decision",
	"council_validated_at" timestamp with time zone,
	"council_validated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_cards_kind_period" CHECK (("report_cards"."kind" = 'period') = ("report_cards"."period_id" is not null)),
	CONSTRAINT "report_cards_decision_annual" CHECK ("report_cards"."decision" is null or "report_cards"."kind" = 'annual')
);
--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_general_comment_by_users_id_fk" FOREIGN KEY ("general_comment_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_council_validated_by_users_id_fk" FOREIGN KEY ("council_validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_enrollment_fk" FOREIGN KEY ("enrollment_id","academic_year_id","school_id") REFERENCES "public"."enrollments"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_period_fk" FOREIGN KEY ("period_id","academic_year_id","school_id") REFERENCES "public"."periods"("id","academic_year_id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_cards_one_per_period" ON "report_cards" USING btree ("enrollment_id","period_id") WHERE "report_cards"."kind" = 'period';--> statement-breakpoint
CREATE UNIQUE INDEX "report_cards_one_annual" ON "report_cards" USING btree ("enrollment_id") WHERE "report_cards"."kind" = 'annual';--> statement-breakpoint
CREATE INDEX "report_cards_school_idx" ON "report_cards" USING btree ("school_id");