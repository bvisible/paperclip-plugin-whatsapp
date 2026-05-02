import type { PluginContext } from "@paperclipai/plugin-sdk";
import { FRAPPE_RESOLVE_USER_PATH } from "./constants.js";
import type { FrappeUserResolution, ResolvedConfig } from "./types.js";

/**
 * Resolve a phone number to a Frappe user via the local instance.
 *
 * Calls `nora.api.whatsapp_config.resolve_user_from_phone` (whitelisted
 * `allow_guest=True` since Phase 0). Auth is `X-Relay-Token`.
 *
 * Returns null when the phone is unknown.
 */
export async function resolveUserFromPhone(
  ctx: PluginContext,
  config: ResolvedConfig,
  phone: string,
): Promise<FrappeUserResolution | null> {
  const url = `${config.frappeBaseUrl.replace(/\/$/, "")}${FRAPPE_RESOLVE_USER_PATH}`;

  try {
    const response = await ctx.http.fetch(url, {
      method: "POST",
      headers: {
        "X-Relay-Token": config.frappeRelayToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
      ctx.logger.warn("frappe resolve_user_from_phone failed", {
        phone,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as {
      message?: FrappeUserResolution;
    };
    if (!data.message || !data.message.user_email) {
      return null;
    }
    return data.message;
  } catch (err) {
    ctx.logger.error("frappe resolve_user_from_phone error", {
      phone,
      err: (err as Error).message,
    });
    return null;
  }
}
