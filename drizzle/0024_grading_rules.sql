ALTER TABLE "schools" ADD COLUMN "grading_rules" jsonb;--> statement-breakpoint
ALTER TABLE "level_subjects" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;