export async function register() {
  // Opt-in local mode: pull updates by long polling instead of webhooks.
  // Starting it removes the Telegram webhook, which takes the deployed bot
  // offline until `npm run telegram:webhook` is run again.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.TELEGRAM_POLLING === "1"
  ) {
    const { getBot } = await import("@/lib/bot");
    await getBot().initialize();
  }
}
