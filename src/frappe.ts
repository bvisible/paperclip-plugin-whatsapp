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

  const headers: Record<string, string> = {
    "X-Relay-Token": config.frappeRelayToken,
    "Content-Type": "application/json",
  };
  // When the plugin talks to Frappe via a non-public URL (e.g. 127.0.0.1:8000
  // direct gunicorn on the same VM), bench needs an explicit X-Frappe-Site-Name
  // header to know which site to dispatch the request to.
  if (config.frappeSiteName) {
    headers["X-Frappe-Site-Name"] = config.frappeSiteName;
  }

  try {
    const response = await ctx.http.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone }),
    });

    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => "");
      ctx.logger.warn("frappe resolve_user failed", {
        phone,
        status: response.status,
        body: bodySnippet.slice(0, 200),
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
    const e = err as Error;
    ctx.logger.error("frappe resolve_user error", {
      phone,
      message: e?.message ?? String(err),
      name: e?.name,
    });
    return null;
  }
}
