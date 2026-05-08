import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  FRAPPE_RESOLVE_USER_PATH,
  FRAPPE_UPLOAD_AND_SCAN_PATH,
  FRAPPE_USER_THREAD_APPEND_PATH,
  FRAPPE_USER_THREAD_GET_PATH,
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

//// Neoffice Modification: whatsapp-cross-channel-user-thread-read
//// Why: NORA #27 Phase R-V10 — symmetric with appendUserThread. Before
////      creating the WhatsApp issue we read the cross-channel cache so
////      we can inject a markdown history block into the issue description
////      (just like send_threaded does for Quick Chat / Mobile via Phase
////      R-V9). The main agent then sees the prior Quick Chat / Mobile /
////      Raven turns straight from the prompt — no Hindsight dependency.
//// Date: 2026-05-05
//// Refs: NORA [[27-paperclip-neoffice-embed/README]] Phase R-V10
export interface UserThreadMessage {
  role: "user" | "assistant";
  content: string;
  ts?: string;
  channel?: string;
}

export async function getUserThread(
  ctx: PluginContext,
  config: ResolvedConfig,
  canonicalId: string,
): Promise<UserThreadMessage[]> {
  if (!canonicalId) return [];
  const url = `${config.frappeBaseUrl.replace(/\/$/, "")}${FRAPPE_USER_THREAD_GET_PATH}`;
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
      body: JSON.stringify({ canonical_id: canonicalId }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      message?: { canonical_id?: string; messages?: UserThreadMessage[] };
    };
    const msgs = data.message?.messages;
    return Array.isArray(msgs) ? msgs : [];
  } catch (err) {
    const e = err as Error;
    ctx.logger.warn("frappe user_thread_get error", {
      canonicalId,
      message: e?.message ?? String(err),
    });
    return [];
  }
}

const HISTORY_INJECT_LIMIT = 6;

export function formatUserThreadAsBlock(messages: UserThreadMessage[]): string {
  if (!messages.length) return "";
  const tail = messages.slice(-HISTORY_INJECT_LIMIT);
  const lines: string[] = [
    "## Conversation history (recent messages, oldest first)",
    "",
  ];
  for (const msg of tail) {
    const content = (msg.content || "").trim();
    if (!content) continue;
    const label = msg.role === "user" ? "User" : "Nora";
    lines.push(`**[${label}]** ${content}`);
    lines.push("");
  }
  lines.push("## Current message");
  return lines.join("\n");
}
//// End Neoffice Modification: whatsapp-cross-channel-user-thread-read

//// Neoffice Modification: whatsapp-document-scan-from-media
//// Why: NORA #30 R-V15.21 — image/PDF reçus via WhatsApp doivent
////      déclencher la chaîne OCR Document Scan (jusqu'ici jetés par le
////      plugin parce que la branche files était gardée derrière is_audio).
////      L'endpoint Frappe `nora.api.ocr.upload_and_scan_from_relay` décode
////      le base64 → File doctype private → Document Scan + enqueue
////      `ocr_process(create_document_scan=False)` async. Retour synchrone :
////      le nom du Document Scan que le plugin embarque dans la description
////      de l'issue (l'agent OCR pollera ensuite via noraOcrReview).
//// Date: 2026-05-08
//// Refs: NORA [[30-whatsapp-media-tts/02-phase-image-pdf]]
export interface DocumentScanCreateResult {
  fileUrl: string;
  filename: string;
  sizeBytes: number;
  pending: boolean;
}

export async function createDocumentScan(
  ctx: PluginContext,
  config: ResolvedConfig,
  args: {
    base64: string;
    filename: string;
    mimetype: string;
    source?: string;
  },
): Promise<DocumentScanCreateResult | null> {
  const url = `${config.frappeBaseUrl.replace(/\/$/, "")}${FRAPPE_UPLOAD_AND_SCAN_PATH}`;
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
        base64_data: args.base64,
        filename: args.filename,
        mimetype: args.mimetype,
        source: args.source ?? "whatsapp",
      }),
      // The endpoint saves the File + enqueues ocr_process async (no wait
      // on the actual OCR which can take 10-30 s). The synchronous part is
      // base64 decode + File save + frappe.enqueue (~1 s on a healthy
      // instance). 20 s timeout = comfortable margin under load.
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => "");
      ctx.logger.warn("upload_and_scan_from_relay failed", {
        filename: args.filename,
        status: response.status,
        body: bodySnippet.slice(0, 200),
      });
      return null;
    }
    const data = (await response.json()) as {
      message?: {
        file_url?: string;
        filename?: string;
        size_bytes?: number;
        pending?: boolean;
      };
    };
    const wrap = data.message;
    const fileUrl = wrap?.file_url;
    if (!fileUrl) {
      ctx.logger.warn("upload_and_scan_from_relay returned no file_url", {
        filename: args.filename,
      });
      return null;
    }
    return {
      fileUrl,
      filename: wrap?.filename || args.filename,
      sizeBytes: wrap?.size_bytes ?? 0,
      pending: wrap?.pending ?? true,
    };
  } catch (err) {
    const e = err as Error;
    ctx.logger.error("upload_and_scan_from_relay error", {
      filename: args.filename,
      message: e?.message ?? String(err),
      name: e?.name,
    });
    return null;
  }
}
//// End Neoffice Modification: whatsapp-document-scan-from-media
