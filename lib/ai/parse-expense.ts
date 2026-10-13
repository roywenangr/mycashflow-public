import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { simpleParse } from "@/lib/ai/simple-parse";
import { CATEGORIES } from "@/lib/categories";

// Flash-Lite answers in 1-2s; the full Flash alias took 5s to over 2 minutes
// on the free tier for the same results.
const MODEL = process.env.EXPENSE_MODEL ?? "gemini-flash-lite-latest";
// The free tier is overloaded at times ("high demand", or no answer at all),
// one model more than another, so a second one gets a turn before giving up.
const FALLBACK_MODEL =
  process.env.EXPENSE_FALLBACK_MODEL ?? "gemini-flash-latest";
// Gemini is free, so it reads first. Once ANTHROPIC_API_KEY is set, Claude
// (paid, so it does not queue behind the free tier) takes over whenever
// Gemini does not answer in time.
const CLAUDE_MODEL = process.env.EXPENSE_CLAUDE_MODEL ?? "claude-haiku-5-5";
const TIMEOUT_MS = 12_000;
const SHORT_TIMEOUT_MS = 5_000;

type Attempt = { name: string; model: LanguageModel; timeout: number };

/**
 * The models to try, in order. `simple` is true when the message can also be
 * read without any model, which is then the last resort.
 */
function attempts(simple: boolean): Attempt[] {
  const gemini = (name: string, timeout: number) => ({
    name,
    model: google(name),
    timeout,
  });
  if (process.env.ANTHROPIC_API_KEY) {
    return [
      // Kept short: Gemini answers in a second or two when it answers at all.
      gemini(MODEL, SHORT_TIMEOUT_MS),
      {
        name: CLAUDE_MODEL,
        model: anthropic(CLAUDE_MODEL),
        timeout: TIMEOUT_MS,
      },
    ];
  }
  return simple
    ? [gemini(MODEL, SHORT_TIMEOUT_MS)]
    : [gemini(MODEL, TIMEOUT_MS), gemini(FALLBACK_MODEL, TIMEOUT_MS)];
}

/** Thrown when no model answered and the message was not simple enough to read without one. */
export class ModelUnavailable extends Error {}

const schema = z.object({
  expenses: z.array(
    z.object({
      amount: z.number().int().positive().describe("Nominal dalam rupiah utuh"),
      category: z.enum(CATEGORIES),
      description: z.string().describe("Deskripsi singkat, huruf kecil"),
      merchant: z.string().nullable().describe("Nama toko/merchant bila ada"),
      date: z
        .string()
        .nullable()
        .describe("Tanggal pengeluaran YYYY-MM-DD, null bila hari ini"),
      walletId: z
        .number()
        .int()
        .nullable()
        .describe("ID dompet yang disebut di pesan, null bila tidak disebut"),
    }),
  ),
  note: z
    .string()
    .nullable()
    .describe("Pesan singkat ke pengguna bila tidak ada yang bisa dicatat"),
});

export type WalletOption = { id: number; label: string };
export type ParsedExpense = z.infer<typeof schema>["expenses"][number];
export type ParseResult = z.infer<typeof schema> & {
  /** True when the models were unavailable and the message was read by simple rules. */
  simple?: boolean;
};

function systemPrompt(todayDate: string, wallets: WalletOption[]) {
  const walletList = wallets.length
    ? wallets.map((w) => `- ID ${w.id}: ${w.label}`).join("\n")
    : "(belum ada dompet)";

  return `Kamu adalah pencatat pengeluaran pribadi untuk pengguna di Indonesia. Tugasmu mengekstrak pengeluaran dari pesan chat, foto struk, atau foto bukti transfer.

Hari ini tanggal ${todayDate}.

Aturan nominal (selalu rupiah utuh):
- "rb", "ribu", "k" = ribuan: "25rb" = 25000, "18k" = 18000, "7,5rb" = 7500.
- "jt", "juta" = jutaan: "1,5jt" = 1500000.
- Bahasa gaul: "goceng" = 5000, "ceban" = 10000, "goban" = 50000, "cepek" = 100000, "gopek" = 500, "seceng" = 1000.
- Angka polos tanpa satuan dipakai apa adanya: "25000" = 25000.

Dompet yang tersedia:
${walletList}

Aturan dompet:
- Isi walletId hanya bila pesan menyebut salah satu dompet di daftar ("pakai bca", "via blu", "kopi 20rb seabank"), atau bila bukti transfer jelas berasal dari bank/e-wallet yang namanya sama dengan salah satu dompet di daftar. Cocokkan tanpa membedakan huruf besar/kecil.
- Bila tidak ada dompet yang disebut, atau yang disebut tidak ada di daftar, isi null. Jangan menebak.
- Nama dompet bukan merchant dan bukan bagian deskripsi.

Aturan pencatatan:
- Satu pesan boleh berisi beberapa pengeluaran ("makan 25rb, parkir 2rb"): catat masing-masing.
- Untuk foto struk: catat SATU pengeluaran dengan total akhir yang dibayar (setelah pajak/diskon), merchant dari kop struk, dan tanggal dari struk bila terbaca. Deskripsi merangkum isi belanja.
- Untuk foto bukti transfer (screenshot m-banking, e-wallet, atau QRIS yang berhasil): catat SATU pengeluaran dengan kategori "Transfer", nominal yang ditransfer ditambah biaya admin bila tertera, deskripsi "transfer ke <nama penerima>" (tambahkan berita/catatan transfer bila ada), merchant null, dan tanggal dari bukti bila terbaca. Bila bukti menunjukkan transaksi gagal atau masih diproses, jangan dicatat dan jelaskan di note. Pembayaran QRIS ke toko/merchant bukan transfer: perlakukan seperti struk dengan kategori yang sesuai.
- Pesan teks tentang mengirim uang ke orang lain ("transfer 500rb ke budi", "tf ibu 1jt") juga kategori "Transfer" dengan deskripsi "transfer ke <nama>".
- Bila pengguna menyertakan caption pada foto, pakai sebagai petunjuk deskripsi/kategori.
- Tanggal: null berarti hari ini. Isi hanya bila pengguna menyebut waktu lain ("kemarin", "tgl 5") atau tertera di struk.
- Pilih kategori yang paling cocok; pakai "Lainnya" bila ragu.
- Jangan mengarang nominal. Bila pesan bukan pengeluaran atau nominalnya tidak jelas, kembalikan expenses kosong dan isi note dengan penjelasan singkat dalam bahasa Indonesia santai, pakai satu-dua emoji.`;
}

export async function parseExpense(input: {
  text: string;
  images: Uint8Array[];
  today: string;
  wallets: WalletOption[];
}): Promise<ParseResult> {
  // Plain "nasgor 25k" messages can be recorded without a model, so for
  // those the model only gets a short wait before the simple reading is used.
  const simple =
    input.images.length === 0 && input.text ? simpleParse(input) : null;
  for (const { name, model, timeout } of attempts(simple !== null)) {
    try {
      return await askModel(model, timeout, input);
    } catch (error) {
      console.warn(`Model ${name} tidak menjawab`, (error as Error).message);
    }
  }
  if (!simple) throw new ModelUnavailable("Tidak ada model yang menjawab");
  return { expenses: simple, note: null, simple: true };
}

async function askModel(
  model: LanguageModel,
  timeout: number,
  input: {
    text: string;
    images: Uint8Array[];
    today: string;
    wallets: WalletOption[];
  },
): Promise<ParseResult> {
  const { output } = await generateText({
    model,
    system: systemPrompt(input.today, input.wallets),
    output: Output.object({ schema }),
    // Move on rather than leave the chat hanging.
    abortSignal: AbortSignal.timeout(timeout),
    // The SDK's own retries would outlast the timeout.
    maxRetries: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: input.text || "(foto struk tanpa caption)",
          },
          ...input.images.map((data) => ({
            type: "file" as const,
            mediaType: "image",
            data,
          })),
        ],
      },
    ],
  });
  return output;
}
