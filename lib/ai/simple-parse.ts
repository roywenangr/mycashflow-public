import { parseAmount } from "@/lib/amount";
import { CATEGORIES, type Category } from "@/lib/categories";
import { shiftDay } from "@/lib/dates";

type Item = {
  amount: number;
  category: Category;
  description: string;
  merchant: string | null;
  date: string | null;
  walletId: number | null;
};

// Rough guesses by keyword; anything else lands in "Lainnya".
const KEYWORDS: [string, RegExp][] = [
  ["Transfer", /\b(transfer|tf|trf|kirim uang)\b/],
  [
    "Makan & Minum",
    /\b(makan|sarapan|nasi|nasgor|mie|mi|bakso|soto|sate|ayam|gorengan|kopi|teh|es|minum|jajan|snack|roti|warteg|padang|pecel|bubur|martabak|boba|jus|air mineral|galon)\b/,
  ],
  [
    "Transportasi",
    /\b(grab|gojek|gocar|goride|ojek|ojol|bensin|pertalite|pertamax|parkir|tol|angkot|bus|kereta|krl|mrt|taksi|travel|tiket)\b/,
  ],
  [
    "Tagihan & Utilitas",
    /\b(listrik|token|pln|pulsa|kuota|paket data|wifi|internet|pdam|air pam|bpjs|cicilan|tagihan|kos|kontrakan|sewa)\b/,
  ],
  [
    "Belanja",
    /\b(belanja|shopee|tokopedia|lazada|baju|celana|sepatu|indomaret|alfamart|minimarket|supermarket)\b/,
  ],
  ["Kesehatan", /\b(obat|dokter|apotek|klinik|rs|rumah sakit|vitamin)\b/],
  ["Hiburan", /\b(nonton|bioskop|netflix|spotify|game|topup|konser|karaoke)\b/],
];

function categoryOf(text: string): Category {
  const found = KEYWORDS.find(
    ([category, words]) =>
      (CATEGORIES as readonly string[]).includes(category) && words.test(text),
  );
  return (found?.[0] as Category | undefined) ?? "Lainnya";
}

/**
 * Reads plain "what amount" messages without the model, for when it is
 * unavailable: "nasgor 25k", "grab 18rb pakai bca, parkir 2000". Returns null
 * unless every part of the message has exactly one amount, so nothing is
 * recorded on a guess.
 */
export function simpleParse(input: {
  text: string;
  today: string;
  wallets: { id: number; label: string }[];
}): Item[] | null {
  const parts = input.text
    .split(/[,\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 20) return null;

  const items: Item[] = [];
  for (const part of parts) {
    let rest = part.toLowerCase();

    let walletId: number | null = null;
    // Longest names first, so "bca digital" wins over "bca".
    const byLength = [...input.wallets].sort(
      (a, b) => b.label.length - a.label.length,
    );
    for (const wallet of byLength) {
      const name = wallet.label.toLowerCase().replace(/\s*\(.*\)$/, "");
      const at = rest.indexOf(name);
      if (name && at >= 0) {
        walletId = wallet.id;
        rest = `${rest.slice(0, at)} ${rest.slice(at + name.length)}`;
        break;
      }
    }

    let date: string | null = null;
    if (/\bkemarin\b/.test(rest)) {
      date = shiftDay(input.today, -1);
      rest = rest.replace(/\bkemarin\b/, " ");
    }

    // "25 rb" is one amount, like "25rb".
    const words = rest
      .replace(/(\d)\s+(rb|ribu|k|jt|juta)\b/g, "$1$2")
      .split(/\s+/)
      .filter(Boolean);
    const amounts = words.filter((word) => parseAmount(word) !== null);
    if (amounts.length !== 1) return null;

    const description = words
      .filter((word) => word !== amounts[0])
      .filter((word) => !["pakai", "pake", "via", "dari", "rp"].includes(word))
      .join(" ");
    if (!description) return null;

    items.push({
      amount: parseAmount(amounts[0])!,
      category: categoryOf(description),
      description,
      merchant: null,
      date,
      walletId,
    });
  }
  return items;
}
