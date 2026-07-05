CREATE TABLE "discovery_state" (
	"platform" "platform" PRIMARY KEY NOT NULL,
	"cursor" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
