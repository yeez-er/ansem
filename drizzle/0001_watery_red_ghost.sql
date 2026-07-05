CREATE TABLE "resolution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "resolution_attempts_user_id_attempted_at_idx" ON "resolution_attempts" USING btree ("user_id","attempted_at");