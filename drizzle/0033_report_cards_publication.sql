ALTER TABLE "report_cards" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_cards" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "report_cards" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_published_after_council" CHECK ("published_at" is null or ("council_validated_at" is not null and "snapshot" is not null and "published_by" is not null));
