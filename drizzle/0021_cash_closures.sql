CREATE TYPE "public"."closure_status" AS ENUM('closed', 'reopened');--> statement-breakpoint
CREATE TABLE "cash_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"day" date NOT NULL,
	"receipt_count" integer NOT NULL,
	"cash_total" integer NOT NULL,
	"mobile_money_total" integer NOT NULL,
	"transfer_total" integer NOT NULL,
	"cheque_total" integer NOT NULL,
	"total" integer NOT NULL,
	"counted_cash" integer NOT NULL,
	"difference" integer NOT NULL,
	"note" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "closure_status" DEFAULT 'closed' NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	CONSTRAINT "cash_closures_totals" CHECK ("cash_closures"."total" = "cash_closures"."cash_total" + "cash_closures"."mobile_money_total" + "cash_closures"."transfer_total" + "cash_closures"."cheque_total"
        and "cash_closures"."difference" = "cash_closures"."counted_cash" - "cash_closures"."cash_total" and "cash_closures"."counted_cash" >= 0),
	CONSTRAINT "cash_closures_reopened" CHECK ("cash_closures"."status" = 'closed' or ("cash_closures"."reopened_by" is not null and "cash_closures"."reopened_at" is not null and "cash_closures"."reopen_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_closures_one_closed" ON "cash_closures" USING btree ("school_id","cashier_id","day") WHERE "cash_closures"."status" = 'closed';--> statement-breakpoint
CREATE INDEX "cash_closures_school_day_idx" ON "cash_closures" USING btree ("school_id","day");