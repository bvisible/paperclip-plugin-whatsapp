import type { PluginContext } from "@paperclipai/plugin-sdk";
import { FRAPPE_RESOLVE_USER_PATH } from "./constants.js";
import type { FrappeUserResolution, ResolvedConfig } from "./types.js";

/**
 * Resolve a phone number to a Frappe user via the local instance.
 *
 * Calls `nora.api.whatsapp_config.resolve_user` (whitelisted
 * `allow_guest=True`, validated via X-Relay-Token = NORA Settings
 * collective_api_key).
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
      ctx.logger.warn("frappe resolve_user failed", {
        phone,
        status: response.status,
      });
      return null;
    }

    // The Frappe endpoint returns {"message": {"success": true, "user": {...}}}
    // or {"message": {"success": false, "error": "..."}}.
    const data = (await response.json()) as {
      message?: {
        success?: boolean;
        user?: FrappeUserResolution;
        error?: string;
      };
    };

    const wrap = data.message;
    if (!wrap || !wrap.success || !wrap.user) {
      return null;
    }
    // The wrapper.user contains {user, email, full_name, ...}. Treat
    // missing email as "unknown user" (the Frappe endpoint should always
    // return both, but be defensive).
    if (!wrap.user.email && !wrap.user.user) {
      return null;
    }
    return wrap.user;
  } catch (err) {
    ctx.logger.error("frappe resolve_user error", {
      phone,
      err: (err as Error).message,
    });
    return null;
  }
}
