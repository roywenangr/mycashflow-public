import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Unpooled connection is preferred for schema changes.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  // Leave the Chat SDK state tables (chat_state_*) alone.
  tablesFilter: ["users", "expenses", "wallets", "wallet_entries"],
});
