import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { ParsedExpense } from "@/lib/ai/parse-expense";
import { isDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { expenses, type Expense } from "@/lib/db/schema";

export async function recordExpenses(input: {
  userId: string;
  items: ParsedExpense[];
  source: Expense["source"];
  today: string;
}): Promise<Expense[]> {
  const batch = crypto.randomUUID().slice(0, 8);
  return getDb()
    .insert(expenses)
    .values(
      input.items.map((item) => ({
        userId: input.userId,
        batch,
        walletId: item.walletId,
        amount: item.amount,
        category: item.category,
        description: item.description,
        merchant: item.merchant,
        spentOn: isDate(item.date) ? item.date : input.today,
        source: input.source,
      })),
    )
    .returning();
}

/** Only deletes an expense of this person. */
export async function deleteExpense(
  id: number,
  userId: string,
): Promise<Expense | null> {
  const [row] = await getDb()
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
    .returning();
  return row ?? null;
}

/** Sets the paying wallet for every expense this person recorded in one message. */
export async function setBatchWallet(
  batch: string,
  walletId: number | null,
  userId: string,
): Promise<Expense[]> {
  const rows = await getDb()
    .update(expenses)
    .set({ walletId })
    .where(and(eq(expenses.batch, batch), eq(expenses.userId, userId)))
    .returning();
  return rows.sort((a, b) => a.id - b.id);
}

export async function getLastExpense(userId: string): Promise<Expense | null> {
  const [row] = await getDb()
    .select()
    .from(expenses)
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.id))
    .limit(1);
  return row ?? null;
}

/** This person's expenses for dates in [start, end), oldest first. */
export async function getExpensesBetween(
  start: string,
  end: string,
  userId: string,
): Promise<Expense[]> {
  return getDb()
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.userId, userId),
        gte(expenses.spentOn, start),
        lt(expenses.spentOn, end),
      ),
    )
    .orderBy(expenses.spentOn, expenses.id);
}

/** Sum and count of this person's expenses for dates in [start, end). */
export async function getTotal(start: string, end: string, userId: string) {
  const [row] = await getDb()
    .select({
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.userId, userId),
        gte(expenses.spentOn, start),
        lt(expenses.spentOn, end),
      ),
    );
  return row;
}
