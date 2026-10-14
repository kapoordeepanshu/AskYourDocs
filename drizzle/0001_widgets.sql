CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"greeting" text NOT NULL,
	"fallback_message" text NOT NULL,
	"accent_color" text DEFAULT '#2563eb' NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"document_ids" uuid[],
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "widget_id" uuid;--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "widgets_public_key_idx" ON "widgets" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "widgets_owner_idx" ON "widgets" USING btree ("owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_widget_id_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_widget_idx" ON "conversations" USING btree ("widget_id","created_at" DESC NULLS LAST);