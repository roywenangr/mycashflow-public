const UNITS: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
};

/**
 * Parses rupiah shorthand: "25000", "25.000", "25rb", "18k", "1,5jt".
 * Returns whole rupiah, or null when the text is not a positive amount.
 */
export function parseAmount(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .replace(/^rp\.?\s*/, "")
    .match(/^(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?$/);
  if (!match) return null;

  const [, digits, unit] = match;
  const value = unit
    ? // With a unit the separator is a decimal mark: "1,5jt", "7.5rb".
      Number(digits.replace(",", ".")) * UNITS[unit]
    : // Without one, dots and commas only group thousands: "25.000".
      Number(digits.replace(/[.,]/g, ""));

  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
