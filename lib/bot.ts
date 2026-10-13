import { createPostgresState } from "@chat-adapter/state-pg";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  type ActionEvent,
  type Message,
  type Thread,
} from "chat";
import { ModelUnavailable, parseExpense } from "@/lib/ai/parse-expense";
import { parseAmount } from "@/lib/amount";
import {
  followUpPrompt,
  FOLLOW_UPS,
  isFollowUp,
  KEYBOARD_VERSION,
  keyboardKey,
  menuKey,
  showKeyboard,
} from "@/lib/bot-menu";
import { categoryLabel } from "@/lib/categories";
import { isPeriod, periodDetail, periodInfo, recentMonths } from "@/lib/check";
import { formatDay, formatMonth, shiftDay, today } from "@/lib/dates";
import type { Expense, User } from "@/lib/db/schema";
import {
  deleteExpense,
  getLastExpense,
  getTotal,
  recordExpenses,
  setBatchWallet,
} from "@/lib/expenses";
import { formatRupiah } from "@/lib/format";
import {
  deleteAccount,
  getUser,
  inviteCodeIn,
  registerUser,
} from "@/lib/users";
import {
  createWallet,
  deleteWallet,
  draftEntry,
  getWallet,
  getWallets,
  move,
  placeEntry,
  type WalletWithBalance,
} from "@/lib/wallets";

const HELP = `✍️ Kirim pengeluaranmu dengan bahasa bebas, misalnya:
🍜 makan siang 25rb
🛵 grab ke kantor 18k pakai bca
💡 kemarin bayar listrik 350rb

📸 Atau kirim foto struk atau bukti transfer, nanti kubaca nominalnya.
👆 Setelah tercatat, pilih dompet yang dipakai lewat tombol.

⌨️ Semua perintah di bawah ini juga ada sebagai tombol di bawah kolom ketik.

🔎 /cek — lihat pengeluaran: hari ini, 1 minggu terakhir, atau pilih bulan
👛 /dompet — daftar dompet dan saldonya
➕ /dompet tambah BCA 1,5jt — dompet baru dengan saldo awal
💵 /masuk 5jt gaji — catat pemasukan
🔁 /pindah 500rb — pindah dana antar dompetmu
💸 /transfer 500rb ke Budi — catat transfer ke orang lain (masuk pengeluaran)
🗑️ /hapus — hapus catatan pengeluaran terakhir
🧹 /hapusakun — hapus semua datamu dari bot ini`;

const LOCKED =
  "🔒 Bot ini hanya untuk yang punya kode undangan.\n\nKirim kode undanganmu di sini untuk mulai.";
const NO_WALLETS =
  "👛 Belum ada dompet. Tambah dulu lewat tombol ➕ Dompet baru, atau ketik:\n/dompet tambah BCA 1,5jt";
const GONE = "🫥 Dompet itu sudah tidak ada.";
const SORRY = "😵‍💫 Maaf, ada gangguan. Coba lagi sebentar lagi ya 🙏";

const WALLET_ACTION = "w";
const DELETE_LAST_ACTION = "dl";
const CHECK_PERIOD_ACTION = "cp";
const CHECK_MONTHS_ACTION = "cm";
const CHECK_ACTION = "cd";
const WALLET_DELETE_PICK = "wdp";
const WALLET_DELETE = "wd";
const WALLET_DELETE_CONFIRM = "wdc";
const ENTRY_WALLET = "ew";
const MOVE_FROM = "mf";
const MOVE_TO = "mt";
const ACCOUNT_DELETE = "ad";
const ALL = "all";

type WalletRef = { id: number; name: string };

/** Wallet buttons, three to a row so the labels stay readable. */
function walletButtonRows(
  wallets: WalletRef[],
  actionId: string,
  value: (wallet: WalletRef) => string,
  selectedId?: number | null,
) {
  const rows = [];
  for (let i = 0; i < wallets.length; i += 3) {
    rows.push(
      Actions(
        wallets.slice(i, i + 3).map((wallet) =>
          Button({
            id: actionId,
            value: value(wallet),
            label: `${wallet.id === selectedId ? "✅" : "👛"} ${wallet.name}`,
          }),
        ),
      ),
    );
  }
  return rows;
}

function balanceLine(wallet: WalletWithBalance) {
  return `💰 Saldo ${wallet.name}: ${formatRupiah(wallet.balance)}`;
}

function describe(expense: Expense): string {
  return `${formatRupiah(expense.amount)} · ${expense.description} (${formatDay(expense.spentOn)})`;
}

function reply(
  event: ActionEvent,
  message: Parameters<ActionEvent["adapter"]["postMessage"]>[1],
) {
  return event.adapter.postMessage(event.threadId, message);
}

/** Replaces the tapped message, which also removes its buttons. */
async function replace(
  event: ActionEvent,
  message: Parameters<ActionEvent["adapter"]["editMessage"]>[2],
) {
  try {
    await event.adapter.editMessage(event.threadId, event.messageId, message);
  } catch (error) {
    // Telegram rejects an edit that changes nothing.
    console.warn("Gagal memperbarui pesan", error);
  }
}

function createBot() {
  const bot = new Chat({
    userName: process.env.TELEGRAM_BOT_USERNAME ?? "mycashflow_bot",
    adapters: {
      telegram: createTelegramAdapter({
        // Polling is the opt-in local mode; see instrumentation.ts.
        mode: process.env.TELEGRAM_POLLING === "1" ? "polling" : "webhook",
      }),
    },
    state: createPostgresState(),
    // Don't lose expenses sent while a previous one is still being parsed.
    concurrency: "queue",
  });

  bot.onDirectMessage(async (thread, message, _channel, context) => {
    for (const queued of [...(context?.skipped ?? []), message]) {
      try {
        await handleMessage(bot, thread, queued);
      } catch (error) {
        console.error("Gagal memproses pesan", error);
        await thread.post(SORRY);
      }
    }
  });

  // Telegram delivers /commands here, never to onDirectMessage.
  bot.onSlashCommand(async (event) => {
    try {
      const userId = event.user.userId;
      const user =
        (await getUser(userId)) ??
        // "t.me/<bot>?start=<code>" arrives as "/start <code>".
        (event.command.toLowerCase() === "/start"
          ? await join(userId, event.user.fullName, event.text)
          : null);
      if (!user) return void (await event.channel.post(LOCKED));
      await event.channel.post(
        await runCommand(event.command, event.text, user),
      );
      await ensureKeyboard(bot, userId);
    } catch (error) {
      console.error("Gagal memproses perintah", error);
      await event.channel.post(SORRY);
    }
  });

  /** Runs a button tap for a registered person; strangers get no answer. */
  const onTap = (
    actionId: string,
    handler: (event: ActionEvent, userId: string) => Promise<unknown>,
  ) =>
    bot.onAction(actionId, async (event) => {
      try {
        const user = await getUser(event.user.userId);
        if (user) await handler(event, user.id);
      } catch (error) {
        console.error(`Gagal memproses tombol ${actionId}`, error);
        await reply(event, SORRY);
      }
    });

  onTap(WALLET_ACTION, async (event, userId) => {
    const [walletId, batch] = (event.value ?? "").split(":");
    const wallet = await getWallet(Number(walletId), userId);
    if (!wallet || !batch) return reply(event, GONE);

    const rows = await setBatchWallet(batch, wallet.id, userId);
    if (rows.length === 0) return reply(event, "🫥 Catatan ini sudah dihapus.");
    await replace(event, await recordedCard(rows, userId));
  });

  onTap(DELETE_LAST_ACTION, async (event, userId) => {
    if (!event.value) {
      return replace(event, "👍 Batal, tidak ada yang dihapus.");
    }
    const gone = await deleteExpense(Number(event.value), userId);
    return replace(
      event,
      gone
        ? `🗑️ Dihapus: ${describe(gone)}`
        : "🫥 Catatan itu sudah tidak ada.",
    );
  });

  // "Pilih bulan" on /cek: the recent months to choose from.
  onTap(CHECK_MONTHS_ACTION, async (event) => {
    const months = recentMonths();
    const rows = [];
    for (let i = 0; i < months.length; i += 2) {
      rows.push(
        Actions(
          months.slice(i, i + 2).map((month) =>
            Button({
              id: CHECK_PERIOD_ACTION,
              value: month,
              label: formatMonth(month),
            }),
          ),
        ),
      );
    }
    return reply(
      event,
      Card({ children: [CardText("📆 Bulan yang mana?"), ...rows] }),
    );
  });

  // Step two of /cek: one wallet, or everything.
  onTap(CHECK_PERIOD_ACTION, async (event, userId) => {
    const period = event.value;
    if (!isPeriod(period)) return reply(event, EXPIRED);
    const wallets = await getWallets(userId);
    return reply(
      event,
      // Without wallets there is nothing to choose between.
      wallets.length === 0
        ? await periodDetail(period, userId)
        : Card({
            children: [
              CardText(
                `👀 Pengeluaran ${periodInfo(period).label}, dari dompet mana?`,
              ),
              Actions([
                Button({
                  id: CHECK_ACTION,
                  value: `${period}:${ALL}`,
                  label: "🧾 Semua dompet",
                }),
              ]),
              ...walletButtonRows(
                wallets,
                CHECK_ACTION,
                (w) => `${period}:${w.id}`,
              ),
            ],
          }),
    );
  });

  onTap(CHECK_ACTION, async (event, userId) => {
    const [period, wallet] = (event.value ?? "").split(":");
    if (!isPeriod(period)) return reply(event, EXPIRED);
    return reply(
      event,
      await periodDetail(
        period,
        userId,
        wallet === ALL ? undefined : Number(wallet),
      ),
    );
  });

  onTap(WALLET_DELETE_PICK, async (event, userId) =>
    reply(event, await walletDeletePicker(userId)),
  );

  onTap(WALLET_DELETE, async (event, userId) => {
    const wallet = await getWallet(Number(event.value), userId);
    if (!wallet) return replace(event, GONE);
    return replace(
      event,
      Card({
        children: [
          CardText(
            `⚠️ Yakin hapus dompet ${wallet.name}? Saldonya ${formatRupiah(wallet.balance)}.\n\nCatatan pemasukan, transfer, dan pindah dana dompet ini ikut terhapus. Pengeluarannya tetap ada, tapi tanpa dompet.`,
          ),
          Actions([
            Button({
              id: WALLET_DELETE_CONFIRM,
              value: String(wallet.id),
              label: "🗑️ Ya, hapus",
            }),
            Button({ id: WALLET_DELETE_CONFIRM, label: "Batal" }),
          ]),
        ],
      }),
    );
  });

  onTap(WALLET_DELETE_CONFIRM, async (event, userId) => {
    if (!event.value) {
      return replace(event, "👍 Batal, dompetnya tidak dihapus.");
    }
    const wallet = await getWallet(Number(event.value), userId);
    if (!wallet) return replace(event, GONE);
    await deleteWallet(wallet.id, userId);
    return replace(event, `🗑️ Dompet ${wallet.name} dihapus.`);
  });

  // The wallet an income goes into.
  onTap(ENTRY_WALLET, async (event, userId) => {
    const [entryId, walletId] = (event.value ?? "").split(":").map(Number);
    const entry = await placeEntry(entryId, walletId, userId);
    if (!entry) return replace(event, "✔️ Pemasukan ini sudah dicatat.");
    // Read after placing, for the balance including this income.
    const wallet = await getWallet(walletId, userId);
    if (!wallet) return replace(event, GONE);
    return replace(
      event,
      `✅ Pemasukan ${formatRupiah(entry.amount)}${entry.note ? ` · ${entry.note}` : ""} masuk ke 👛 ${wallet.name} 🎉\n${balanceLine(wallet)}`,
    );
  });

  onTap(MOVE_FROM, async (event, userId) => {
    const [amount, fromId] = (event.value ?? "").split(":").map(Number);
    const wallets = await getWallets(userId);
    const from = wallets.find((wallet) => wallet.id === fromId);
    if (!from) return replace(event, GONE);
    return replace(
      event,
      Card({
        children: [
          CardText(
            `🔁 Pindah ${formatRupiah(amount)} dari 👛 ${from.name}\n\nKe dompet mana?`,
          ),
          ...walletButtonRows(
            wallets.filter((wallet) => wallet.id !== from.id),
            MOVE_TO,
            (w) => `${amount}:${from.id}:${w.id}`,
          ),
        ],
      }),
    );
  });

  onTap(MOVE_TO, async (event, userId) => {
    const [amount, fromId, toId] = (event.value ?? "").split(":").map(Number);
    const before = await getWallets(userId);
    const from = before.find((wallet) => wallet.id === fromId);
    const to = before.find((wallet) => wallet.id === toId);
    if (!from || !to || from.id === to.id || !(amount > 0)) {
      return replace(event, GONE);
    }

    await move({ userId, from, to, amount });
    const after = await getWallets(userId);
    return replace(
      event,
      [
        `✅ ${formatRupiah(amount)} dipindah: ${from.name} → ${to.name}`,
        ...after
          .filter((wallet) => wallet.id === fromId || wallet.id === toId)
          .map(balanceLine),
      ].join("\n"),
    );
  });

  onTap(ACCOUNT_DELETE, async (event, userId) => {
    if (!event.value) {
      return replace(event, "👍 Batal, datamu tetap aman.");
    }
    await deleteAccount(userId);
    const state = bot.getState();
    await state.delete(keyboardKey(userId));
    await state.delete(followUpKey(userId));
    return replace(
      event,
      "🧹 Semua datamu sudah dihapus dari bot ini. Kalau mau pakai lagi, kirim kode undangan.",
    );
  });

  return bot;
}

const EXPIRED = "⌛ Tombol ini sudah tidak berlaku. Kirim /cek lagi ya.";

/** Lets a new person in when the text is an invite code. */
async function join(
  userId: string,
  name: string | undefined,
  text: string,
): Promise<User | null> {
  const inviteCode = inviteCodeIn(text);
  if (!inviteCode) return null;
  return registerUser({ id: userId, name: name || null, inviteCode });
}

async function walletDeletePicker(userId: string) {
  const wallets = await getWallets(userId);
  if (wallets.length === 0) return NO_WALLETS;
  return Card({
    children: [
      CardText("🗑️ Hapus dompet yang mana?"),
      ...walletButtonRows(wallets, WALLET_DELETE, (w) => String(w.id)),
    ],
  });
}

async function walletCommand(args: string, userId: string) {
  const [sub = "", ...rest] = args.trim().split(/\s+/);

  if (sub.toLowerCase() === "hapus") return walletDeletePicker(userId);
  if (sub.toLowerCase() === "tambah") {
    // A trailing amount is the opening balance: "/dompet tambah BCA 1,5jt".
    const opening = rest.length > 1 ? parseAmount(rest.at(-1)!) : null;
    const name = (opening === null ? rest : rest.slice(0, -1)).join(" ");
    if (!name) {
      return "✍️ Tulis nama dompetnya, misalnya:\n/dompet tambah BCA 1,5jt";
    }
    if (name.length > 30)
      return "✍️ Nama dompetnya kepanjangan, maksimal 30 huruf.";
    const wallet = await createWallet({
      userId,
      name,
      initialBalance: opening ?? 0,
    });
    return wallet
      ? `👛 Dompet ${wallet.name} dibuat ✨\n💰 Saldo awal: ${formatRupiah(wallet.initialBalance)}`
      : `🙅 Kamu sudah punya dompet bernama ${name}.`;
  }
  if (sub) return `🤷 Perintah dompet "${sub}" tidak kukenal.\n\n${HELP}`;

  const wallets = await getWallets(userId);
  if (wallets.length === 0) return NO_WALLETS;
  const total = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);
  return Card({
    children: [
      CardText(
        [
          "👛 Dompet",
          ...wallets.map(
            (wallet) => `• ${wallet.name}: ${formatRupiah(wallet.balance)}`,
          ),
          `\n💰 Total saldo: ${formatRupiah(total)}`,
        ].join("\n"),
      ),
      Actions([Button({ id: WALLET_DELETE_PICK, label: "🗑️ Hapus dompet" })]),
    ],
  });
}

/** /masuk: an amount, a note, then a wallet picked by button. */
async function incomeCommand(args: string, userId: string) {
  const [first = "", ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(first);
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/masuk 5jt gaji";
  }
  const wallets = await getWallets(userId);
  if (wallets.length === 0) return NO_WALLETS;

  const note = rest.join(" ").slice(0, 80) || null;
  // Saved now and attached to a wallet on tap, so the note survives the
  // 64-byte limit on button data.
  const entry = await draftEntry({ userId, kind: "income", amount, note });
  return Card({
    children: [
      CardText(
        `💵 Pemasukan ${formatRupiah(amount)}${note ? ` · ${note}` : ""}\n\nMasuk ke dompet mana?`,
      ),
      ...walletButtonRows(wallets, ENTRY_WALLET, (w) => `${entry.id}:${w.id}`),
    ],
  });
}

/**
 * /transfer: money sent to someone else. Recorded as an expense in the
 * "Transfer" category, so it shows in /cek and comes out of a wallet like any
 * other spending.
 */
async function transferCommand(args: string, userId: string) {
  const [first = "", ...rest] = args.trim().split(/\s+/);
  const amount = parseAmount(first);
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/transfer 500rb ke Budi";
  }
  const detail = rest.join(" ").slice(0, 80);
  const rows = await recordExpenses({
    userId,
    items: [
      {
        amount,
        category: "Transfer",
        description: `transfer${detail ? ` ${detail.toLowerCase()}` : ""}`,
        merchant: null,
        date: null,
        walletId: null,
      },
    ],
    source: "text",
    today: today(),
  });
  return recordedCard(rows, userId);
}

async function moveCommand(args: string, userId: string) {
  const amount = parseAmount(args.trim().split(/\s+/)[0] ?? "");
  if (amount === null) {
    return "✍️ Tulis jumlahnya dulu, misalnya:\n/pindah 500rb";
  }
  const wallets = await getWallets(userId);
  if (wallets.length === 0) return NO_WALLETS;
  if (wallets.length < 2) return "🔁 Pindah dana butuh minimal dua dompet.";
  return Card({
    children: [
      CardText(`🔁 Pindah ${formatRupiah(amount)}\n\nDari dompet mana?`),
      ...walletButtonRows(wallets, MOVE_FROM, (w) => `${amount}:${w.id}`),
    ],
  });
}

async function runCommand(command: string, args: string, user: User) {
  switch (command.toLowerCase()) {
    case "/start":
    case "/help":
      return `👋 Halo${user.name ? ` ${user.name}` : ""}! Aku pencatat pengeluaranmu 💸\n\n${HELP}`;
    case "/cek":
      return Card({
        children: [
          CardText("🔎 Mau cek pengeluaran yang mana?"),
          // One per row: three long labels would be cut off side by side.
          Actions([
            Button({
              id: CHECK_PERIOD_ACTION,
              value: "d",
              label: "📅 Hari ini",
            }),
          ]),
          Actions([
            Button({
              id: CHECK_PERIOD_ACTION,
              value: "w",
              label: "🗓️ 1 minggu terakhir",
            }),
          ]),
          Actions([
            Button({ id: CHECK_MONTHS_ACTION, label: "📆 Pilih bulan" }),
          ]),
        ],
      });
    case "/hapus": {
      const last = await getLastExpense(user.id);
      if (!last) return "🤷 Belum ada catatan yang bisa dihapus.";
      // Asked first: a menu button is easy to tap by accident.
      return Card({
        children: [
          CardText(`🗑️ Hapus catatan terakhir?\n\n${describe(last)}`),
          Actions([
            Button({
              id: DELETE_LAST_ACTION,
              value: String(last.id),
              label: "🗑️ Ya, hapus",
            }),
            Button({ id: DELETE_LAST_ACTION, label: "Batal" }),
          ]),
        ],
      });
    }
    case "/dompet":
      return walletCommand(args, user.id);
    case "/masuk":
      return incomeCommand(args, user.id);
    case "/transfer":
      return transferCommand(args, user.id);
    case "/pindah":
      return moveCommand(args, user.id);
    case "/hapusakun":
      return Card({
        children: [
          CardText(
            "⚠️ Hapus SEMUA datamu dari bot ini? Dompet, pengeluaran, pemasukan, dan transfer akan hilang permanen dan tidak bisa dikembalikan.",
          ),
          Actions([
            Button({
              id: ACCOUNT_DELETE,
              value: "yes",
              label: "🧹 Ya, hapus semua",
            }),
            Button({ id: ACCOUNT_DELETE, label: "Batal" }),
          ]),
        ],
      });
    default:
      return `🤷 Perintah ${command} tidak kukenal.\n\n${HELP}`;
  }
}

/** How long a menu button waits for the amount typed after it. */
const FOLLOW_UP_MS = 5 * 60 * 1000;
const followUpKey = (userId: string) => `followup:${userId}`;

/** Sends the menu buttons to someone who doesn't have this version yet. */
async function ensureKeyboard(bot: Chat, userId: string) {
  try {
    const state = bot.getState();
    if ((await state.get(keyboardKey(userId))) === KEYBOARD_VERSION) return;
    if (await showKeyboard(userId)) {
      await state.set(keyboardKey(userId), KEYBOARD_VERSION);
    }
  } catch (error) {
    console.error("Gagal memasang tombol menu", error);
  }
}

/**
 * A tap on a menu button, or the amount typed after one. Returns false when
 * the message is neither, so it is read as an expense.
 */
async function handleMenu(
  bot: Chat,
  thread: Thread,
  text: string,
  user: User,
): Promise<boolean> {
  const state = bot.getState();
  const key = menuKey(text);
  const waiting = await state.get(followUpKey(user.id));
  if (waiting) await state.delete(followUpKey(user.id));

  if (key === "batal") {
    await thread.post(
      waiting ? "👍 Oke, batal." : "👍 Tidak ada yang perlu dibatalkan.",
    );
  } else if (isFollowUp(key)) {
    await state.set(followUpKey(user.id), key, FOLLOW_UP_MS);
    await thread.post(followUpPrompt(key));
  } else if (key) {
    const command = key === "bantuan" ? "/help" : `/${key}`;
    await thread.post(await runCommand(command, "", user));
  } else if (isFollowUp(waiting)) {
    const { command, prefix } = FOLLOW_UPS[waiting];
    await thread.post(await runCommand(command, prefix + text, user));
  } else {
    return false;
  }
  return true;
}

async function handleMessage(bot: Chat, thread: Thread, message: Message) {
  const userId = message.author.userId;
  const text = message.text.trim();

  let user = await getUser(userId);
  if (!user) {
    user = await join(userId, message.author.fullName, text);
    await thread.post(user ? await runCommand("/start", "", user) : LOCKED);
    if (user) await ensureKeyboard(bot, userId);
    return;
  }

  const images: Uint8Array[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type === "image" && attachment.fetchData) {
      images.push(new Uint8Array(await attachment.fetchData()));
    }
  }
  if (!text && images.length === 0) {
    await thread.post(
      `🙈 Aku cuma bisa membaca teks, foto struk, dan bukti transfer.\n\n${HELP}`,
    );
    return;
  }
  if (images.length > 0) {
    // A photo is always a receipt or a transfer proof, and it answers
    // whatever button was tapped before it.
    await bot.getState().delete(followUpKey(userId));
  } else if (await handleMenu(bot, thread, text, user)) {
    await ensureKeyboard(bot, userId);
    return;
  }

  // Only a courtesy: failing to show "typing…" must not lose the expense.
  await thread.startTyping().catch(() => {});
  const date = today();
  const wallets = await getWallets(userId);
  const parsed = await parseExpense({
    // Long pastes are not expenses; don't pay to read all of them.
    text: text.slice(0, 1000),
    images: images.slice(0, 1),
    today: date,
    wallets: wallets.map((wallet) => ({ id: wallet.id, label: wallet.name })),
  }).catch((error) => {
    if (error instanceof ModelUnavailable) return null;
    throw error;
  });
  if (!parsed) {
    await thread.post(
      images.length > 0
        ? "🤖 Layanan AI yang membaca foto sedang sibuk di sisi Google, jadi fotonya belum bisa kubaca. Coba kirim lagi beberapa menit lagi, atau ketik saja, misalnya: makan siang 25rb"
        : "🤖 Layanan AI yang membaca pesan sedang sibuk di sisi Google, dan pesan ini terlalu rumit untuk kubaca tanpa bantuannya. Coba lagi beberapa menit lagi, atau tulis singkat seperti: nasgor 25k",
    );
    return;
  }
  // Don't trust an ID the model made up.
  for (const item of parsed.expenses) {
    if (!wallets.some((w) => w.id === item.walletId)) item.walletId = null;
  }
  // "bensin 50k via blu, parkir 2rb": one wallet named, so it paid for all.
  const named = new Set(
    parsed.expenses.map((item) => item.walletId).filter((id) => id !== null),
  );
  for (const item of parsed.expenses) {
    item.walletId = named.size === 1 ? [...named][0] : null;
  }

  if (parsed.expenses.length === 0) {
    await thread.post(
      parsed.note ?? "🧐 Aku tidak menemukan pengeluaran di pesan itu.",
    );
    return;
  }

  const rows = await recordExpenses({
    userId,
    // A receipt is one expense; a message rarely holds more than a handful.
    items: parsed.expenses.slice(0, 20),
    source: images.length > 0 ? "receipt" : "text",
    today: date,
  });
  await thread.post(await recordedCard(rows, userId));
  if (parsed.simple) {
    await thread.post(
      "ℹ️ Layanan AI sedang sibuk, jadi pesan ini kubaca dengan cara sederhana. Jumlahnya aman, tapi kategorinya cuma tebakan.",
    );
  }
  await ensureKeyboard(bot, userId);
}

/** The confirmation for one message's expenses, with the wallet buttons. */
async function recordedCard(rows: Expense[], userId: string) {
  const date = today();
  const [wallets, { total, count }] = await Promise.all([
    getWallets(userId),
    getTotal(date, shiftDay(date, 1), userId),
  ]);
  const lines = rows.map((row) => {
    const merchant = row.merchant ? ` @ ${row.merchant}` : "";
    const when = row.spentOn === date ? "" : ` (${formatDay(row.spentOn)})`;
    return `✅ ${formatRupiah(row.amount)} · ${categoryLabel(row.category)}\n📝 ${row.description}${merchant}${when}`;
  });
  lines.push(`💰 Total hari ini: ${formatRupiah(total)} (${count} transaksi)`);

  const batch = rows[0].batch!;
  const paid = wallets.find((wallet) => wallet.id === rows[0].walletId);
  if (wallets.length === 0) {
    lines.push(
      "👛 Belum punya dompet? Tap ➕ Dompet baru supaya saldonya ikut terlacak.",
    );
    return lines.join("\n\n");
  }
  lines.push(
    paid
      ? `👛 Dibayar pakai ${paid.name}\n${balanceLine(paid)}\n\nSalah dompet? Ganti lewat tombol:`
      : "👛 Bayar pakai dompet apa?",
  );
  return Card({
    children: [
      CardText(lines.join("\n\n")),
      ...walletButtonRows(
        wallets,
        WALLET_ACTION,
        // Telegram caps callback data at 64 bytes; the batch id keeps it short.
        (w) => `${w.id}:${batch}`,
        paid?.id,
      ),
    ],
  });
}

// One instance per process, surviving dev hot reloads so polling isn't doubled.
const globalForBot = globalThis as { __mycashflowBot?: Chat };

export function getBot() {
  if (!globalForBot.__mycashflowBot) globalForBot.__mycashflowBot = createBot();
  return globalForBot.__mycashflowBot;
}
