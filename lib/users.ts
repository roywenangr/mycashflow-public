import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

/** The codes that let a new person in: INVITE_CODES, separated by commas. */
function inviteCodes(): string[] {
  return (process.env.INVITE_CODES ?? "")
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

/** The invite code a message is, or null. Case does not matter. */
export function inviteCodeIn(text: string): string | null {
  const given = text.trim().toLowerCase();
  return inviteCodes().find((code) => code === given) ?? null;
}

export async function getUser(id: string): Promise<User | null> {
  const [user] = await getDb().select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function registerUser(input: {
  id: string;
  name: string | null;
  inviteCode: string;
}): Promise<User> {
  const db = getDb();
  await db.insert(users).values(input).onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.id, input.id));
  return user;
}

/** Removes the person and, with them, their wallets, entries and expenses. */
export async function deleteAccount(id: string) {
  await getDb().delete(users).where(eq(users.id, id));
}
