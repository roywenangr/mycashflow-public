import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { walletEntries, wallets, type Wallet } from "@/lib/db/schema";

export type WalletWithBalance = Wallet & { balance: number };

// Table names are spelled out: drizzle renders interpolated columns
// unqualified here, which would compare wallet_entries.wallet_id to its own id.
const balance = sql<number>`(
  "wallets"."initial_balance"
  + coalesce((select sum(e.amount) from wallet_entries e where e.wallet_id = "wallets"."id"), 0)
  - coalesce((select sum(x.amount) from expenses x where x.wallet_id = "wallets"."id"), 0)
)::float8`;

/** One person's wallets with their current balance. */
export async function getWallets(userId: string): Promise<WalletWithBalance[]> {
  return getDb()
    .select({
      id: wallets.id,
      userId: wallets.userId,
      name: wallets.name,
      initialBalance: wallets.initialBalance,
      createdAt: wallets.createdAt,
      balance,
    })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .orderBy(asc(wallets.name));
}

/** A wallet, only when it belongs to this person. */
export async function getWallet(id: number, userId: string) {
  return (await getWallets(userId)).find((wallet) => wallet.id === id) ?? null;
}

/** Returns null when the person already has a wallet with this name. */
export async function createWallet(input: {
  userId: string;
  name: string;
  initialBalance: number;
}): Promise<Wallet | null> {
  const db = getDb();
  const [existing] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, input.userId),
        sql`lower(${wallets.name}) = ${input.name.toLowerCase()}`,
      ),
    );
  if (existing) return null;

  const [wallet] = await db.insert(wallets).values(input).returning();
  return wallet;
}

/** Its expenses stay but lose the wallet; its other entries go with it. */
export async function deleteWallet(id: number, userId: string) {
  await getDb()
    .delete(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
}

/**
 * Remembers money coming in or going out until its wallet is picked with a
 * button, so the note survives the 64-byte limit on button data.
 */
export async function draftEntry(input: {
  userId: string;
  amount: number;
  kind: "income";
  note: string | null;
}) {
  const [entry] = await getDb()
    .insert(walletEntries)
    .values({ ...input, walletId: null })
    .returning();
  return entry;
}

/**
 * Puts a waiting entry into one of the person's wallets. Null when it was
 * already placed or either of them is not theirs.
 */
export async function placeEntry(
  entryId: number,
  walletId: number,
  userId: string,
) {
  if (!(await getWallet(walletId, userId))) return null;
  const [entry] = await getDb()
    .update(walletEntries)
    .set({ walletId })
    .where(
      and(
        eq(walletEntries.id, entryId),
        eq(walletEntries.userId, userId),
        isNull(walletEntries.walletId),
      ),
    )
    .returning();
  return entry ?? null;
}

/** Moves money between two wallets of the same person. */
export async function move(input: {
  userId: string;
  from: { id: number; name: string };
  to: { id: number; name: string };
  amount: number;
}) {
  await getDb()
    .insert(walletEntries)
    .values([
      {
        userId: input.userId,
        walletId: input.from.id,
        amount: -input.amount,
        kind: "move",
        note: `Pindah ke ${input.to.name}`,
      },
      {
        userId: input.userId,
        walletId: input.to.id,
        amount: input.amount,
        kind: "move",
        note: `Pindah dari ${input.from.name}`,
      },
    ]);
}
