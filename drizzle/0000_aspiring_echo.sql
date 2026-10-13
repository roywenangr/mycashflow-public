CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" integer,
	"batch" text,
	"amount" bigint NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"spent_on" date NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" integer,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"initial_balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_user_spent_on_idx" ON "expenses" USING btree ("user_id","spent_on");--> statement-breakpoint
CREATE INDEX "wallet_entries_user_idx" ON "wallet_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");