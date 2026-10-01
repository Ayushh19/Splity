CREATE TYPE "public"."member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'removed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."paused_reason" AS ENUM('manual', 'removed_participant', 'removed_payer');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."revision_action" AS ENUM('create', 'update', 'delete', 'restore', 'dispute', 'merge_repoint');--> statement-breakpoint
CREATE TYPE "public"."revision_entity" AS ENUM('expense', 'settlement');--> statement-breakpoint
CREATE TYPE "public"."settlement_method" AS ENUM('upi', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."split_method" AS ENUM('equal', 'exact', 'shares');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_member" uuid,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"revision_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_payers" (
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"paid_minor" bigint NOT NULL,
	CONSTRAINT "expense_payers_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id"),
	CONSTRAINT "expense_payers_positive" CHECK ("expense_payers"."paid_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "expense_splits" (
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"shares" integer,
	"exact_minor" bigint,
	"owed_minor" bigint NOT NULL,
	CONSTRAINT "expense_splits_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id"),
	CONSTRAINT "expense_splits_owed_non_negative" CHECK ("expense_splits"."owed_minor" >= 0),
	CONSTRAINT "expense_splits_shares_positive" CHECK ("expense_splits"."shares" IS NULL OR "expense_splits"."shares" >= 1),
	CONSTRAINT "expense_splits_exact_non_negative" CHECK ("expense_splits"."exact_minor" IS NULL OR "expense_splits"."exact_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"notes" text,
	"expense_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"split_method" "split_method" NOT NULL,
	"original_currency" char(3),
	"original_amount_minor" bigint,
	"fx_rate" numeric(20, 10),
	"receipt_key" text,
	"recurring_series_id" uuid,
	"occurrence_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "expenses_one_per_occurrence" UNIQUE("recurring_series_id","occurrence_date"),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_minor" > 0),
	CONSTRAINT "expenses_fx_all_or_none" CHECK (("expenses"."original_currency" IS NULL) = ("expenses"."original_amount_minor" IS NULL)
      AND ("expenses"."original_currency" IS NULL) = ("expenses"."fx_rate" IS NULL)),
	CONSTRAINT "expenses_fx_rate_positive" CHECK ("expenses"."fx_rate" IS NULL OR "expenses"."fx_rate" > 0),
	CONSTRAINT "expenses_original_amount_positive" CHECK ("expenses"."original_amount_minor" IS NULL OR "expenses"."original_amount_minor" > 0),
	CONSTRAINT "expenses_occurrence" CHECK (("expenses"."recurring_series_id" IS NULL) = ("expenses"."occurrence_date" IS NULL)),
	CONSTRAINT "expenses_created_by" CHECK ("expenses"."created_by" IS NOT NULL OR "expenses"."recurring_series_id" IS NOT NULL),
	CONSTRAINT "expenses_deleted" CHECK (("expenses"."deleted_at" IS NULL) = ("expenses"."deleted_by" IS NULL)),
	CONSTRAINT "expenses_version_positive" CHECK ("expenses"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"merged_into" uuid,
	"sort_key" bigint GENERATED ALWAYS AS IDENTITY (sequence name "group_members_sort_key_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_since" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "group_members_group_id_id" UNIQUE("group_id","id"),
	CONSTRAINT "group_members_admin_is_user" CHECK ("group_members"."role" <> 'admin' OR "group_members"."user_id" IS NOT NULL),
	CONSTRAINT "group_members_user_since" CHECK (("group_members"."user_id" IS NULL) = ("group_members"."user_since" IS NULL)),
	CONSTRAINT "group_members_merged" CHECK (("group_members"."status" = 'merged') = ("group_members"."merged_into" IS NOT NULL)),
	CONSTRAINT "group_members_removed_at" CHECK (("group_members"."status" = 'removed') = ("group_members"."removed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"simplify_debts" boolean DEFAULT true NOT NULL,
	"is_direct" boolean DEFAULT false NOT NULL,
	"direct_key" text,
	"invite_token" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	CONSTRAINT "groups_direct_key_unique" UNIQUE("direct_key"),
	CONSTRAINT "groups_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "groups_currency_format" CHECK ("groups"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "groups_direct_key" CHECK ("groups"."is_direct" = ("groups"."direct_key" IS NOT NULL)),
	CONSTRAINT "groups_direct_no_invite" CHECK (NOT "groups"."is_direct" OR "groups"."invite_token" IS NULL),
	CONSTRAINT "groups_direct_not_archived" CHECK (NOT "groups"."is_direct" OR "groups"."archived_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"anchor_day" smallint NOT NULL,
	"next_due" date NOT NULL,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"paused_reason" "paused_reason",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_series_anchor_day" CHECK (("recurring_series"."frequency" = 'weekly' AND "recurring_series"."anchor_day" BETWEEN 1 AND 7)
       OR ("recurring_series"."frequency" = 'monthly' AND "recurring_series"."anchor_day" BETWEEN 1 AND 31)),
	CONSTRAINT "recurring_series_paused_reason" CHECK (("recurring_series"."status" = 'paused') = ("recurring_series"."paused_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_member" uuid NOT NULL,
	"to_member" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_distinct_members" CHECK ("reminders"."from_member" <> "reminders"."to_member")
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "revision_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" "revision_action" NOT NULL,
	"actor_member" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revisions_entity_version" UNIQUE("entity_type","entity_id","version")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_member" uuid NOT NULL,
	"to_member" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"settled_on" date NOT NULL,
	"method" "settlement_method" DEFAULT 'other' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"disputed_at" timestamp with time zone,
	"disputed_by" uuid,
	"dispute_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "settlements_distinct_members" CHECK ("settlements"."from_member" <> "settlements"."to_member"),
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount_minor" > 0),
	CONSTRAINT "settlements_recorded_by_party" CHECK ("settlements"."recorded_by" IN ("settlements"."from_member", "settlements"."to_member")),
	CONSTRAINT "settlements_disputed" CHECK (("settlements"."disputed_at" IS NULL) = ("settlements"."disputed_by" IS NULL)
      AND ("settlements"."disputed_by" IS NULL OR ("settlements"."disputed_by" IN ("settlements"."from_member", "settlements"."to_member") AND "settlements"."disputed_by" <> "settlements"."recorded_by"))),
	CONSTRAINT "settlements_deleted" CHECK (("settlements"."deleted_at" IS NULL) = ("settlements"."deleted_by" IS NULL)),
	CONSTRAINT "settlements_version_positive" CHECK ("settlements"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"photo_url" text,
	"upi_id" text,
	"default_currency" char(3) DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_default_currency_format" CHECK ("users"."default_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_member_group_members_id_fk" FOREIGN KEY ("actor_member") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_series_id_recurring_series_id_fk" FOREIGN KEY ("recurring_series_id") REFERENCES "public"."recurring_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_member" FOREIGN KEY ("group_id","created_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deleted_by_member" FOREIGN KEY ("group_id","deleted_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_merged_into_group_members_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_archived_by_group_members_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_created_by_member" FOREIGN KEY ("group_id","created_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_from_member" FOREIGN KEY ("group_id","from_member") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_to_member" FOREIGN KEY ("group_id","to_member") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actor_member_group_members_id_fk" FOREIGN KEY ("actor_member") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_member" FOREIGN KEY ("group_id","from_member") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_member" FOREIGN KEY ("group_id","to_member") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_recorded_by_member" FOREIGN KEY ("group_id","recorded_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_disputed_by_member" FOREIGN KEY ("group_id","disputed_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deleted_by_member" FOREIGN KEY ("group_id","deleted_by") REFERENCES "public"."group_members"("group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_group_time_idx" ON "activity_events" USING btree ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_payers_member_idx" ON "expense_payers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "expense_splits_member_idx" ON "expense_splits" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "expenses_group_date_idx" ON "expenses" USING btree ("group_id","expense_date");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_per_user" ON "group_members" USING btree ("group_id","user_id") WHERE "group_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_series_due_idx" ON "recurring_series" USING btree ("next_due") WHERE "recurring_series"."status" = 'active';--> statement-breakpoint
CREATE INDEX "reminders_pair_time_idx" ON "reminders" USING btree ("group_id","from_member","to_member","sent_at");--> statement-breakpoint
CREATE INDEX "settlements_group_idx" ON "settlements" USING btree ("group_id");