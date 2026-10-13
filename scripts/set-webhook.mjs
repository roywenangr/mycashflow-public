// Points the Telegram bot at the deployed webhook.
// Usage: npm run telegram:webhook -- https://your-app.vercel.app
const [baseUrl] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;

if (!baseUrl || !token || !secret) {
  console.error(
    "Butuh URL deploy sebagai argumen, serta TELEGRAM_BOT_TOKEN dan TELEGRAM_WEBHOOK_SECRET_TOKEN di .env.local",
  );
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: new URL("/api/webhooks/telegram", baseUrl).href,
    secret_token: secret,
    // callback_query carries the taps on inline buttons.
    allowed_updates: ["message", "callback_query"],
  }),
});
const body = await res.json();
console.log(body.ok ? "Webhook terpasang." : `Gagal: ${body.description}`);

// The list behind Telegram's "Menu" button, next to the message box.
const commands = await fetch(
  `https://api.telegram.org/bot${token}/setMyCommands`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "cek", description: "Lihat pengeluaran" },
        { command: "dompet", description: "Dompet dan saldonya" },
        { command: "hapus", description: "Hapus catatan terakhir" },
        { command: "help", description: "Bantuan dan semua perintah" },
      ],
    }),
  },
).then((response) => response.json());
console.log(
  commands.ok ? "Menu perintah terpasang." : `Gagal: ${commands.description}`,
);
process.exit(body.ok && commands.ok ? 0 : 1);
