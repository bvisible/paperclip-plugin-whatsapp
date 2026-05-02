import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginWebhookInput,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";

import {
  DEFAULT_CONFIG,
  PLUGIN_ID,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";
import { resolveUserFromPhone } from "./frappe.js";
import { sendWhatsAppText } from "./router-client.js";
import { transcribeAudio } from "./transcription.js";
import type {
  PluginInstanceConfig,
  ResolvedConfig,
  RouterWebhookPayload,
  WhatsappSendParams,
} from "./types.js";

// Module-scoped context, captured during setup() and used by webhook/tool handlers.
let currentContext: PluginContext | null = null;

function requireContext(): PluginContext {
  if (!currentContext) {
    throw new Error(`${PLUGIN_ID}: plugin context not initialized`);
  }
  return currentContext;
}

async function resolveConfig(ctx: PluginContext): Promise<ResolvedConfig> {
  const raw = ((await ctx.config.get?.()) ?? {}) as PluginInstanceConfig;

  const readSecret = async (ref: string | undefined): Promise<string> => {
    if (!ref) return "";
    try {
      return (await ctx.secrets.resolve(ref)) ?? "";
    } catch {
      return "";
    }
  };

  return {
    routerBaseUrl: raw.routerBaseUrl ?? DEFAULT_CONFIG.routerBaseUrl,
    routerApiKey: await readSecret(raw.routerApiKeyRef),
    webhookSecret: await readSecret(raw.webhookSecretRef),
    frappeBaseUrl: raw.frappeBaseUrl ?? DEFAULT_CONFIG.frappeBaseUrl,
    frappeRelayToken: await readSecret(raw.frappeRelayTokenRef),
    transcriptionUrl: raw.transcriptionUrl ?? DEFAULT_CONFIG.transcriptionUrl,
    transcriptionModel:
      raw.transcriptionModel ?? DEFAULT_CONFIG.transcriptionModel,
    transcriptionLanguage:
      raw.transcriptionLanguage ?? DEFAULT_CONFIG.transcriptionLanguage,
    transcriptionApiKey: await readSecret(raw.transcriptionApiKeyRef),
    fallbackAgentId: raw.fallbackAgentId ?? DEFAULT_CONFIG.fallbackAgentId,
    companyId: raw.companyId ?? "",
  };
}

function verifyWebhookAuth(
  headers: Record<string, string | string[] | undefined>,
  expected: string,
): boolean {
  if (!expected) return false;
  const candidates: Array<string | undefined> = [];
  const tok = headers["x-relay-token"] ?? headers["X-Relay-Token"];
  if (typeof tok === "string") candidates.push(tok);
  const auth = headers["authorization"] ?? headers["Authorization"];
  if (typeof auth === "string") {
    candidates.push(auth.replace(/^Bearer\s+/i, ""));
  }
  return candidates.some((value) => value === expected);
}

function buildIssueTitle(
  userName: string | undefined,
  message: string,
): string {
  const prefix = DEFAULT_CONFIG.whatsappIssueTitlePrefix;
  const subject = (message ?? "").trim();
  const truncated =
    subject.length > DEFAULT_CONFIG.maxIssueTitleLength
      ? `${subject.slice(0, DEFAULT_CONFIG.maxIssueTitleLength - 1)}…`
      : subject;
  return userName
    ? `${prefix} from ${userName}: ${truncated}`
    : `${prefix}: ${truncated}`;
}

async function handleWhatsappSend(
  params: unknown,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const ctx = requireContext();
  const typed = params as WhatsappSendParams | undefined;
  if (!typed || !typed.phone || !typed.text) {
    return { error: "missing required parameters: phone, text" };
  }

  const config = await resolveConfig(ctx);
  if (!config.routerApiKey) {
    return { error: "router api key not configured" };
  }

  const result = await sendWhatsAppText(ctx, config, {
    phone: typed.phone,
    text: typed.text,
    replyTo: typed.replyTo,
  });

  if (!result.ok) {
    return { error: `whatsapp send failed: ${result.error ?? "unknown"}` };
  }

  return {
    content: `WhatsApp message sent to ${typed.phone} (${typed.text.length} chars).`,
  };
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;
    ctx.logger.info(`${PLUGIN_ID} initialized`, {
      capabilities: ctx.manifest.capabilities?.length,
      webhooks: ctx.manifest.webhooks?.map((w) => w.endpointKey),
      tools: ctx.manifest.tools?.map((t) => t.name),
    });

    ctx.tools.register(
      TOOL_NAMES.sendText,
      {
        displayName: "Send WhatsApp message",
        description:
          "Send a WhatsApp text message to a phone number via the central Baileys router. Use this when an agent needs to reply to a WhatsApp conversation.",
        parametersSchema: {
          type: "object",
          properties: {
            phone: {
              type: "string",
              description:
                "Recipient phone number in E.164 format (e.g. +41791234567).",
            },
            text: {
              type: "string",
              description: "Message text (UTF-8, max 4096 chars).",
              maxLength: 4096,
            },
            replyTo: {
              type: "string",
              description:
                "Optional WhatsApp message ID to quote in the reply.",
            },
          },
          required: ["phone", "text"],
        },
      },
      handleWhatsappSend,
    );
  },

  async onWebhook(input: PluginWebhookInput) {
    const ctx = requireContext();

    if (input.endpointKey !== WEBHOOK_KEYS.inbox) {
      throw new Error(`unsupported webhook endpoint: ${input.endpointKey}`);
    }

    const config = await resolveConfig(ctx);

    if (!verifyWebhookAuth(input.headers, config.webhookSecret)) {
      ctx.logger.warn("webhook auth failed", { requestId: input.requestId });
      throw new Error("unauthorized");
    }

    const body = input.parsedBody as RouterWebhookPayload | undefined;
    if (!body || !body.phone || (!body.message && !body.is_audio)) {
      ctx.logger.warn("webhook payload missing phone or message", {
        requestId: input.requestId,
      });
      throw new Error("invalid_payload");
    }

    let messageText = body.message ?? "";

    // 1. Voice transcription via Cohere Transcribe (whisper.noraai.ch URL legacy).
    if (body.is_audio && body.files && body.files.length > 0) {
      const audio = body.files[0];
      const transcription = await transcribeAudio(
        ctx,
        config,
        audio.data,
        audio.mimetype,
      );
      if (transcription) {
        messageText = transcription;
        ctx.logger.info("voice note transcribed", {
          phone: body.phone,
          length: transcription.length,
        });
      } else {
        messageText =
          "[transcription failed — please send the message as text]";
      }
    }

    // 2. Resolve user via Frappe local.
    const resolution = await resolveUserFromPhone(ctx, config, body.phone);
    if (!resolution || !resolution.user_email) {
      ctx.logger.info("phone not registered", { phone: body.phone });
      return;
    }

    const agentId = resolution.agent_id ?? config.fallbackAgentId;

    if (!config.companyId) {
      ctx.logger.error("companyId not configured — cannot create issue");
      throw new Error("company_id_missing");
    }

    const title = buildIssueTitle(resolution.user_name, messageText);
    const description = [
      messageText,
      "",
      `[Source: WhatsApp ${body.phone} — ${body.timestamp}]`,
      `[User: ${resolution.user_name ?? "?"} <${resolution.user_email}>]`,
    ].join("\n");

    const issue = await ctx.issues.create({
      companyId: config.companyId,
      title,
      description,
      assigneeAgentId: agentId,
      originKind: `plugin:${PLUGIN_ID}`,
      originId: body.phone,
    });

    ctx.logger.info("issue created from whatsapp", {
      issueId: issue.id,
      phone: body.phone,
      agentId,
    });
  },
});

export default plugin;

// Bind the plugin to the host RPC channel. Required — without this call the
// worker process exits immediately after module evaluation (code=0) and the
// host reports `Worker initialize failed`.
runWorker(plugin, import.meta.url);
