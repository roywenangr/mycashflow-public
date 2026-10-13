import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL belum di-set. Jalankan `npx vercel env pull .env.local` setelah database Neon terpasang.",
    );
  }
  return drizzle(neon(url), { schema });
}

let db: ReturnType<typeof createDb> | null = null;

// Lazy so `next build` doesn't need DATABASE_URL.
export function getDb() {
  if (!db) db = createDb();
  return db;
}
