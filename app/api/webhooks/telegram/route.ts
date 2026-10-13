import { after } from "next/server";
import { getBot } from "@/lib/bot";

export async function POST(request: Request): Promise<Response> {
  // The adapter answers Telegram right away and handles the message in the
  // background; without waitUntil the function is frozen before the reply.
  return getBot().webhooks.telegram(request, {
    waitUntil: (task) => after(() => task),
  });
}
