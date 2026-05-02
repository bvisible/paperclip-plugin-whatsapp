import type { PluginContext } from "@paperclipai/plugin-sdk";
import { ROUTER_SEND_TEXT_PATH } from "./constants.js";
import type { ResolvedConfig } from "./types.js";

/**
 * Send a WhatsApp text message via the central Baileys router (neoservice).
 *
 * The router exposes `POST /api/sendText` with Bearer auth (`ROUTER_API_KEY`).
 * It dispatches to Baileys `sock.sendMessage` for whichever WhatsApp number
 * the central session is bound to.
 */
export async function sendWhatsAppText(
  ctx: PluginContext,
  config: ResolvedConfig,
  params: { phone: string; text: string; replyTo?: string },
): Promise<{ ok: boolean; error?: string }> {
  const url = `${config.routerBaseUrl.replace(/\/$/, "")}${ROUTER_SEND_TEXT_PATH}`;
  const body: Record<string, unknown> = {
    phone: params.phone,
    text: params.text,
  };
  if (params.replyTo) {
    body.replyTo = params.replyTo;
  }

  try {
    const response = await ctx.http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.routerApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      ctx.logger.error("router /api/sendText failed", {
        phone: params.phone,
        status: response.status,
        body: text.slice(0, 200),
      });
      return { ok: false, error: `router_${response.status}` };
    }

    return { ok: true };
  } catch (err) {
    ctx.logger.error("router /api/sendText network error", {
      phone: params.phone,
      err: (err as Error).message,
    });
    return { ok: false, error: "network_error" };
  }
}
