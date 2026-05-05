import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  FRAPPE_RESOLVE_USER_PATH,
  FRAPPE_USER_THREAD_APPEND_PATH,
} from "./constants.js";
import type { FrappeUserResolution, ResolvedConfig } from "./types.js";

/**
 * Resolve a phone number to a Frappe user via the local instance.
 *
 * Calls `nora.api.whatsapp_config.resolve_user` (whitelisted
 * `allow_guest=True`, validated via X-Relay-Token = site_config
 * whatsapp_relay_token, with legacy fallback to NORA Settings
 * collective_api_key).
 *
 * Uses Node's global `fetch` instead of `ctx.http.fetch` because the plugin
 * runs on the same VM as Frappe and resolves the public hostname via
 * /etc/hosts (cloud-init pins it to 127.0.1.1). Paperclip's outbound SSRF
 * guard rejects all private/reserved IPs, which would block every call here.
 * The SDK explicitly allows plugins to use the global fetch directly when
 * they know what they're talking to. Capability `http.outbound` still gates
 * the manifest, and the host audit log captures what we did via ctx.logger.
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
    const response = await fetch(url, {
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

//// Neoffice Modification: whatsapp-cross-channel-user-thread-append
//// Why: NORA #27 Phase R-V10. After we create a Paperclip issue from an
////      inbound WhatsApp message, also write the user message into the
////      Frappe-backed cross-channel cache (nora_v2_user_thread:<canonical_id>)
////      so that the next Quick Chat / Mobile run can read this WhatsApp
////      turn from the new issue's description without waiting for
////      Hindsight retain. The runner mirrors this for the assistant
////      reply just before sending it back via WhatsApp.
//// Date: 2026-05-05
//// Refs: NORA [[27-paperclip-neoffice-embed/README]] Phase R-V10
export async function appendUserThread(
  ctx: PluginContext,
  config: ResolvedConfig,
  args: {
    canonicalId: string;
    role: "user" | "assistant";
    content: string;
    channel?: string;
  },
): Promise<void> {
  if (!args.canonicalId || !args.content) return;

  const url = `${config.frappeBaseUrl.replace(/\/$/, "")}${FRAPPE_USER_THREAD_APPEND_PATH}`;
  const headers: Record<string, string> = {
    "X-Relay-Token": config.frappeRelayToken,
    "Content-Type": "application/json",
  };
  if (config.frappeSiteName) {
    headers["X-Frappe-Site-Name"] = config.frappeSiteName;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        canonical_id: args.canonicalId,
        role: args.role,
        content: args.content.slice(0, 4000),
        channel: args.channel ?? "whatsapp",
      }),
    });
    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => "");
      ctx.logger.warn("frappe user_thread_append failed", {
        canonicalId: args.canonicalId,
        role: args.role,
        status: response.status,
        body: bodySnippet.slice(0, 200),
      });
    }
  } catch (err) {
    const e = err as Error;
    ctx.logger.warn("frappe user_thread_append error", {
      canonicalId: args.canonicalId,
      role: args.role,
      message: e?.message ?? String(err),
    });
  }
}
//// End Neoffice Modification: whatsapp-cross-channel-user-thread-append
