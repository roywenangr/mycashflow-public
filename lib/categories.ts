export const CATEGORIES = [
  "Makan & Minum",
  "Transportasi",
  "Belanja",
  "Tagihan & Utilitas",
  "Hiburan",
  "Kesehatan",
  "Pendidikan",
  "Rumah Tangga",
  // Money sent to someone else: counted as spending, like any other expense.
  "Transfer",
  "Lainnya",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_EMOJI: Record<Category, string> = {
  "Makan & Minum": "🍜",
  Transportasi: "🛵",
  Belanja: "🛍️",
  "Tagihan & Utilitas": "💡",
  Hiburan: "🎬",
  Kesehatan: "💊",
  Pendidikan: "📚",
  "Rumah Tangga": "🏠",
  Transfer: "💸",
  Lainnya: "📦",
};

/** "🍜 Makan & Minum" — for chat messages. */
export function categoryLabel(category: string): string {
  return `${CATEGORY_EMOJI[category as Category] ?? "📦"} ${category}`;
}
