const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "Rp 25.000" */
export function formatRupiah(amount: number): string {
  return rupiah.format(amount);
}

/** "25 rb", "1,5 jt" — for axis ticks. */
export function formatCompact(amount: number): string {
  return compact.format(amount);
}
