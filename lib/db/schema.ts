import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Everyone who got in with an invite code. All other data hangs off a user. */
export const users = pgTable("users", {
  // Telegram user id.
  id: text("id").primaryKey(),
  name: text("name"),
  inviteCode: text("invite_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wallets = pgTable(
  "wallets",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Whole rupiah. The balance is this plus entries minus expenses.
    initialBalance: bigint("initial_balance", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("wallets_user_idx").on(table.userId)],
);

/** Money moving in or out of a wallet other than by an expense. */
export const walletEntries = pgTable(
  "wallet_entries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Null while the entry still waits for its wallet to be picked.
    walletId: integer("wallet_id").references(() => wallets.id, {
      onDelete: "cascade",
    }),
    // Positive for money in, negative for money out.
    amount: bigint("amount", { mode: "number" }).notNull(),
    // income: money coming in. transfer: sent to someone else.
    // move: one side of moving money between the user's own wallets.
    kind: text("kind", { enum: ["income", "transfer", "move"] }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("wallet_entries_user_idx").on(table.userId)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The wallet that paid, or null until picked.
    walletId: integer("wallet_id").references(() => wallets.id, {
      onDelete: "set null",
    }),
    // Groups the expenses recorded from a single message.
    batch: text("batch"),
    // Whole rupiah, no decimals.
    amount: bigint("amount", { mode: "number" }).notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"),
    // Local calendar date of the expense (APP_TIMEZONE), as YYYY-MM-DD.
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    source: text("source", { enum: ["text", "receipt"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("expenses_user_spent_on_idx").on(table.userId, table.spentOn),
  ],
);

export type User = typeof users.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type WalletEntry = typeof walletEntries.$inferSelect;
