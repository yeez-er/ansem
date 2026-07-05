CREATE TYPE "public"."platform" AS ENUM('x', 'tiktok', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."post_source" AS ENUM('submission', 'x_search', 'admin');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('pending', 'approved', 'rejected', 'removed');--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_platform_handle_unique" UNIQUE("platform","handle")
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_post_id" text NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"posted_at" timestamp with time zone,
	"status" "post_status" DEFAULT 'pending' NOT NULL,
	"source" "post_source" NOT NULL,
	"submitted_by_user_id" text,
	"latest_views" bigint DEFAULT 0 NOT NULL,
	"latest_likes" bigint DEFAULT 0 NOT NULL,
	"latest_comments" bigint DEFAULT 0 NOT NULL,
	"latest_shares" bigint DEFAULT 0 NOT NULL,
	"latest_snapshot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_platform_platform_post_id_unique" UNIQUE("platform","platform_post_id")
);
--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_snapshots_post_id_captured_at_idx" ON "metric_snapshots" USING btree ("post_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_status_platform_idx" ON "posts" USING btree ("status","platform");--> statement-breakpoint
CREATE INDEX "posts_creator_id_idx" ON "posts" USING btree ("creator_id");