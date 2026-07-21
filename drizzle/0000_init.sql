CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"embedding" vector(1536),
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"subject" text,
	"sender" text,
	"sender_domain" text,
	"snippet" text,
	"internal_date" timestamp with time zone,
	"embedding" vector(1536),
	"bucket_id" uuid,
	"confidence" real,
	"reason" text,
	"classified_at" timestamp with time zone,
	"gold_label" text
);
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buckets_user_email_idx" ON "buckets" USING btree ("user_email");--> statement-breakpoint
CREATE INDEX "threads_user_email_idx" ON "threads" USING btree ("user_email");