/**
 * The buttons under the message box. Telegram sends a tapped button's label
 * as an ordinary message, so each one is recognised by its words.
 */
const MENU = [
  ["🔎 Cek", "👛 Dompet", "💵 Masuk"],
  ["🔁 Pindah", "💸 Transfer", "➕ Dompet baru"],
  ["🗑️ Hapus", "❓ Bantuan"],
];

const KEYS = [
  "cek",
  "dompet",
  "masuk",
  "pindah",
  "transfer",
  "dompet baru",
  "hapus",
  "bantuan",
  "batal",
] as const;
export type MenuKey = (typeof KEYS)[number];

/** The menu button a message is, by its words alone: emoji vary by device. */
export function menuKey(text: string): MenuKey | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
  return KEYS.find((key) => key === words) ?? null;
}

/** The buttons that need more typed after them, and the command that gets it. */
export const FOLLOW_UPS = {
  masuk: {
    command: "/masuk",
    prefix: "",
    ask: "💵 Pemasukan berapa? Ketik jumlah dan catatannya, misalnya:\n5jt gaji",
  },
  pindah: {
    command: "/pindah",
    prefix: "",
    ask: "🔁 Pindah berapa antar dompetmu? Ketik jumlahnya, misalnya:\n500rb",
  },
  transfer: {
    command: "/transfer",
    prefix: "",
    ask: "💸 Transfer berapa, ke siapa? Ketik jumlah dan tujuannya, misalnya:\n500rb ke Budi\n\nAtau langsung kirim foto bukti transfernya saja.",
  },
  "dompet baru": {
    command: "/dompet",
    prefix: "tambah ",
    ask: "➕ Dompet baru: ketik nama dan saldo awalnya, misalnya:\nBCA 1,5jt",
  },
} as const;
export type FollowUp = keyof typeof FOLLOW_UPS;

export function isFollowUp(key: unknown): key is FollowUp {
  return typeof key === "string" && key in FOLLOW_UPS;
}

/** What to ask after such a button is tapped. */
export function followUpPrompt(key: FollowUp): string {
  return `${FOLLOW_UPS[key].ask}\n\n(ketik batal kalau tidak jadi)`;
}

// Bump when MENU changes, so everyone gets the new buttons once.
export const KEYBOARD_VERSION = "1";
export const keyboardKey = (userId: string) => `keyboard:${userId}`;

/**
 * Puts the menu under the message box. The chat adapter only knows buttons
 * attached to a message, so this one goes to Telegram directly. In a private
 * chat the chat id is the user's id.
 */
export async function showKeyboard(userId: string): Promise<boolean> {
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: "⌨️ Tombol menu ada di bawah kolom ketik. Pengeluaran tinggal diketik seperti biasa, misalnya: makan siang 25rb",
        reply_markup: {
          keyboard: MENU.map((row) => row.map((text) => ({ text }))),
          resize_keyboard: true,
          is_persistent: true,
          input_field_placeholder: "makan siang 25rb",
        },
      }),
    },
  );
  return response.ok;
}
