CREATE TYPE "ban_kind" AS ENUM('ip', 'account');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" serial PRIMARY KEY,
	"kind" "ban_kind" NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL,
	"banned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
CREATE TABLE "items" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"time_acquired" bigint NOT NULL,
	"source" text DEFAULT 'unlock_new_account' NOT NULL,
	"status" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_data" (
	"user_id" text DEFAULT '',
	"user_banned" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"region" text NOT NULL,
	"map_id" integer NOT NULL,
	"game_id" uuid,
	"map_seed" bigint NOT NULL,
	"username" text NOT NULL,
	"player_id" integer,
	"team_mode" integer NOT NULL,
	"team_count" integer NOT NULL,
	"team_total" integer NOT NULL,
	"team_id" integer NOT NULL,
	"time_alive" integer NOT NULL,
	"rank" integer NOT NULL,
	"died" boolean NOT NULL,
	"kills" integer NOT NULL,
	"team_kills" integer DEFAULT 0 NOT NULL,
	"damage_dealt" integer NOT NULL,
	"damage_taken" integer NOT NULL,
	"killer_id" integer NOT NULL,
	"killed_ids" integer[] NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	CONSTRAINT "match_data_pkey" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "player_ips" (
	"game_id" uuid,
	"player_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"username" text NOT NULL,
	"region" text NOT NULL,
	"map_id" integer NOT NULL,
	"team_mode" integer NOT NULL,
	"ip" text NOT NULL,
	"ip_hash" text NOT NULL,
	"find_game_ip" text NOT NULL,
	"find_game_ip_hash" text NOT NULL,
	CONSTRAINT "player_ips_pkey" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_pass" (
	"user_id" text NOT NULL,
	"pass_type" text DEFAULT 'pass_survivr1' NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"unlocks" json DEFAULT '{}' NOT NULL,
	"new_items" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_quest" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"idx" integer NOT NULL,
	"quest_type" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"target" integer NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"rerolled" boolean DEFAULT false NOT NULL,
	"time_acquired" bigint NOT NULL,
	"next_refresh_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"user_created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"banned" boolean DEFAULT false NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"username_set" boolean DEFAULT false NOT NULL,
	"last_username_change_time" timestamp,
	"loadout" json DEFAULT '{"outfit":"outfitBase","melee":"fists","heal":"heal_basic","boost":"boost_basic","player_icon":"","crosshair":{"type":"crosshair_default","color":16777215,"size":"1.00","stroke":"0.00"},"emotes":["emote_happyface","emote_thumbsup","emote_surviv","emote_sadface","",""]}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_idx" ON "account" ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bans_unrevoked_target_idx" ON "bans" ("kind","target") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_items_user_type" ON "items" ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_match_data_user_stats" ON "match_data" ("user_id","team_mode","rank","kills","damage_dealt","time_alive");--> statement-breakpoint
CREATE INDEX "idx_game_id" ON "match_data" ("game_id");--> statement-breakpoint
CREATE INDEX "idx_user_id" ON "match_data" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_match_data_team_query" ON "match_data" ("team_mode","map_id","created_at","game_id","team_id","region","kills");--> statement-breakpoint
CREATE INDEX "player_ips_username_idx" ON "player_ips" ("username","created_at");--> statement-breakpoint
CREATE INDEX "player_ips_user_id_idx" ON "player_ips" ("user_id");--> statement-breakpoint
CREATE INDEX "player_ips_ip_hash_idx" ON "player_ips" ("ip_hash");--> statement-breakpoint
CREATE INDEX "player_ips_find_game_ip_hash_idx" ON "player_ips" ("find_game_ip_hash");--> statement-breakpoint
CREATE INDEX "player_ips_created_at_idx" ON "player_ips" ("created_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_pass_user_type" ON "user_pass" ("user_id","pass_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_quest_user_idx" ON "user_quest" ("user_id","idx");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "user_pass" ADD CONSTRAINT "user_pass_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "user_quest" ADD CONSTRAINT "user_quest_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;