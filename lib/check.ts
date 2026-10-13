import { categoryLabel } from "@/lib/categories";
import {
  currentMonth,
  formatDay,
  formatMonth,
  isMonth,
  monthRange,
  shiftDay,
  shiftMonth,
  today,
} from "@/lib/dates";
import { getExpensesBetween } from "@/lib/expenses";
import { formatRupiah } from "@/lib/format";
import { getWallets } from "@/lib/wallets";

/**
 * What /cek can look at: today ("d"), the last seven days ("w"), or one
 * calendar month ("2026-10").
 */
export type Period = string;

export function isPeriod(value: unknown): value is Period {
  return (
    value === "d" ||
    value === "w" ||
    (isMonth(value) && value <= currentMonth())
  );
}

/** How many past months /cek offers, the current one included. */
const MONTHS_OFFERED = 6;

/** The months /cek offers, newest first. */
export function recentMonths(): string[] {
  const month = currentMonth();
  return Array.from({ length: MONTHS_OFFERED }, (_, i) =>
    shiftMonth(month, -i),
  );
}

/** A period's wording and its dates: `start` inclusive, `end` exclusive. */
export function periodInfo(period: Period) {
  const date = today();
  const tomorrow = shiftDay(date, 1);
  if (period === "d") {
    return {
      label: "hari ini",
      range: formatDay(date),
      start: date,
      end: tomorrow,
      // A single day needs no breakdown and no date on each line.
      long: false,
    };
  }
  if (period === "w") {
    const start = shiftDay(date, -6);
    return {
      label: "1 minggu terakhir",
      range: `${formatDay(start)} – ${formatDay(date)}`,
      start,
      end: tomorrow,
      long: true,
    };
  }
  return {
    label: `di ${formatMonth(period)}`,
    range: null,
    ...monthRange(period),
    long: true,
  };
}

/** "45%", with one decimal for small shares so they don't all read as 0%. */
function percent(part: number, whole: number): string {
  const share = (part / whole) * 100;
  if (share > 0 && share < 0.1) return "<0,1%";
  return `${share < 10 ? share.toFixed(1).replace(".", ",").replace(",0", "") : Math.round(share)}%`;
}

// A Telegram message holds 4096 characters; longer lists point to the dashboard.
const MAX_LISTED = 30;

/**
 * A person's transactions over a period: all of them, or only what one wallet
 * paid for.
 */
export async function periodDetail(
  period: Period,
  userId: string,
  walletId?: number,
) {
  const { label, range, start, end, long } = periodInfo(period);
  const [all, wallets] = await Promise.all([
    getExpensesBetween(start, end, userId),
    getWallets(userId),
  ]);
  const byId = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const wallet = walletId === undefined ? undefined : byId.get(walletId);
  if (walletId !== undefined && !wallet)
    return "🫥 Dompet itu sudah tidak ada.";

  const rows = wallet ? all.filter((row) => row.walletId === wallet.id) : all;
  const scope = wallet ? ` dari 👛 ${wallet.name}` : "";
  if (rows.length === 0) {
    return `🎉 Belum ada pengeluaran ${label}${scope}. Dompet aman!`;
  }

  const sum = rows.reduce((acc, row) => acc + row.amount, 0);
  const lines = [
    `📅 Pengeluaran ${label}${scope}${range ? ` (${range})` : ""}:`,
  ];

  // Newest first once there are several days, so a cut list keeps the latest.
  const listed = (long ? rows.toReversed() : rows).slice(0, MAX_LISTED);
  lines.push(
    ...listed.map((row, i) => {
      const merchant = row.merchant ? ` @ ${row.merchant}` : "";
      const paidFrom = row.walletId && byId.get(row.walletId);
      const tags = [
        ...(long ? [formatDay(row.spentOn)] : []),
        categoryLabel(row.category),
        // The wallet is already in the heading when filtering by it.
        ...(wallet ? [] : [`👛 ${paidFrom ? paidFrom.name : "tanpa dompet"}`]),
      ];
      return `${i + 1}. ${formatRupiah(row.amount)} · ${row.description}${merchant}\n    ${tags.join(" · ")}`;
    }),
  );
  if (rows.length > listed.length) {
    lines.push(
      `…dan ${rows.length - listed.length} transaksi lebih lama, lihat di dashboard.`,
    );
  }
  lines.push(`\n💰 Total: ${formatRupiah(sum)} (${rows.length} transaksi)`);

  // Closes with where the money went, biggest share first.
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    byCategory.set(
      row.category,
      (byCategory.get(row.category) ?? 0) + row.amount,
    );
  }
  lines.push(
    "\n📊 Persentase per kategori:",
    ...[...byCategory]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([category, total]) =>
          `${categoryLabel(category)}: ${percent(total, sum)} (${formatRupiah(total)})`,
      ),
  );
  return lines.join("\n");
}
