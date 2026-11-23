CREATE TYPE "public"."notification_channel" AS ENUM('sms', 'whatsapp');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'receipt';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'bulletin';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'announcement';--> statement-breakpoint
ALTER TYPE "public"."notification_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_one_per_day";--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "notification_channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "notification_templates" jsonb;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "notification_monthly_cap" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "channel" "notification_channel" DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_absence_day" ON "notifications" USING btree ("enrollment_id","date") WHERE "notifications"."kind" = 'absence';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reference" ON "notifications" USING btree ("kind","reference_id","enrollment_id") WHERE "notifications"."reference_id" is not null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_cost" CHECK ("notifications"."cost" >= 0);--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_notification_channel" CHECK ("notification_channel" IN ('sms', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_notification_cap" CHECK ("notification_monthly_cap" IS NULL OR "notification_monthly_cap" BETWEEN 0 AND 100000000);
