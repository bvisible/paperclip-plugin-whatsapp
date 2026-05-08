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
import {
  appendUserThread,
  createDocumentScan,
  type DocumentScanCreateResult,
  formatUserThreadAsBlock,
  getUserThread,
  resolveUserFromPhone,
} from "./frappe.js";
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
    frappeSiteName: raw.frappeSiteName ?? "",
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

    //// Neoffice Modification: whatsapp-document-scan-from-media
    //// Why: NORA #30 R-V15.21 — image/PDF reçus via WhatsApp doivent
    ////      déclencher la chaîne OCR Document Scan. Avant 2026-05-08 cette
    ////      branche n'existait pas : le router downloadait l'image/PDF, le
    ////      plugin reçevait body.files mais ne le lisait QUE pour audio,
    ////      donc toute facture envoyée par WhatsApp était silencieusement
    ////      jetée. Ici on traite chaque file image/PDF en parallèle (best-
    ////      effort, jamais bloquant pour l'issue principale) et on garde
    ////      la liste des document_scan_name créés pour l'embarquer dans la
    ////      description de l'issue plus bas.
    //// Date: 2026-05-08
    //// Refs: NORA [[30-whatsapp-media-tts/02-phase-image-pdf]]
    const documentScans: DocumentScanCreateResult[] = [];
    const SUPPORTED_MEDIA_PREFIXES = ["image/", "application/pdf"];
    if (!body.is_audio && body.files && body.files.length > 0) {
      for (const file of body.files) {
        const supported = SUPPORTED_MEDIA_PREFIXES.some((p) =>
          (file.mimetype || "").toLowerCase().startsWith(p),
        );
        if (!supported) {
          ctx.logger.info("skipping non-supported media", {
            phone: body.phone,
            mimetype: file.mimetype,
            filename: file.filename,
          });
          continue;
        }
        const ds = await createDocumentScan(ctx, config, {
          base64: file.data,
          filename: file.filename,
          mimetype: file.mimetype,
          source: `whatsapp:${body.phone}`,
        });
        if (ds) {
          documentScans.push(ds);
          ctx.logger.info("document scan enqueued from whatsapp media", {
            phone: body.phone,
            fileUrl: ds.fileUrl,
            filename: ds.filename,
            sizeBytes: ds.sizeBytes,
          });
        }
      }
    }
    //// End Neoffice Modification: whatsapp-document-scan-from-media

    // 2. Resolve user via Frappe local.
    const resolution = await resolveUserFromPhone(ctx, config, body.phone);
    const userEmail = resolution?.email ?? resolution?.user;
    if (!resolution || !userEmail) {
      ctx.logger.info("phone not registered", { phone: body.phone });
      return;
    }

    // Phase 2 v1 — no per-user agent mapping yet (Phase 4 will introduce one),
    // every WhatsApp issue lands on the configured fallback agent.
    const agentId = config.fallbackAgentId;

    if (!config.companyId) {
      ctx.logger.error("companyId not configured — cannot create issue");
      throw new Error("company_id_missing");
    }

    const title = buildIssueTitle(resolution.full_name, messageText);

    //// Neoffice Modification: whatsapp-cross-channel-user-thread-read
    //// Why: NORA #27 Phase R-V10 — read the cross-channel cache and inject
    ////      a history block into the description so the main agent sees
    ////      prior Quick Chat / Mobile / Raven turns straight from the
    ////      prompt. Best-effort: empty cache or fetch error means no block.
    //// R-V15.5 — added a 5s race so a slow Frappe doesn't push the whole
    ////      handleWebhook RPC past the 30s host timeout (which causes the
    ////      router to send MSG_INSTANCE_DOWN, then the runner replies
    ////      async, and the user sees a double message).
    let historyBlock = "";
    try {
      const HISTORY_FETCH_TIMEOUT_MS = 5000;
      const priorMessages = await Promise.race([
        getUserThread(ctx, config, userEmail),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("user_thread_get timeout 5s")),
            HISTORY_FETCH_TIMEOUT_MS,
          ),
        ),
      ]);
      historyBlock = formatUserThreadAsBlock(priorMessages);
    } catch (err) {
      ctx.logger.warn("user_thread_get failed (non-fatal)", {
        phone: body.phone,
        error: String(err),
      });
    }
    //// End Neoffice Modification: whatsapp-cross-channel-user-thread-read

    const descriptionParts: string[] = [];
    if (historyBlock) {
      descriptionParts.push(historyBlock, "");
    }
    descriptionParts.push(
      messageText || "[no text content]",
      "",
      `[Source: WhatsApp ${body.phone} — ${body.timestamp}]`,
      `[User: ${resolution.full_name ?? "?"} <${userEmail}>]`,
    );
    //// Neoffice Modification: whatsapp-document-scan-from-media
    //// Why: NORA #30 R-V15.21 — embed the Document Scan names into the
    ////      issue description so the OCR agent (or any specialist) sees
    ////      the attachments straight from the prompt and can poll
    ////      noraOcrReview/noraOcrAndSuggest on them. The OCR pipeline
    ////      is already enqueued async in the relay endpoint; the agent
    ////      just needs to know the scan names.
    //// Date: 2026-05-08
    //// Refs: NORA [[30-whatsapp-media-tts/02-phase-image-pdf]]
    if (documentScans.length > 0) {
      const lines: string[] = ["", "## Pièces jointes WhatsApp (OCR en cours)"];
      for (const ds of documentScans) {
        // We don't have a Document Scan name yet — the relay endpoint
        // enqueues ocr_process async and the DS is created by
        // create_document_scan_from_ocr ~10-30 s later. The OCR agent will
        // see the DS appear in the user's "Pending Action" queue and can
        // call noraOcrReview once it's there. We surface filename + file_url
        // so the agent has enough context to identify the file in question
        // (e.g. when multiple scans are pending for the same supplier).
        lines.push(
          `- 📎 \`${ds.filename}\` (${ds.sizeBytes} B) → \`${ds.fileUrl}\``,
        );
      }
      lines.push(
        "",
        "Le pipeline OCR + suggestion compte tourne en arrière-plan ; le Document Scan apparaîtra dans la file d'attente Pending Action de Neoffice.",
      );
      descriptionParts.push(...lines);
    }
    //// End Neoffice Modification: whatsapp-document-scan-from-media
    const description = descriptionParts.join("\n");

    // Phase 2.5 — enrich originId so the Hindsight plugin (forked) can extract
    // the user identity at agent.run.{started,finished} time and pin the bank
    // to a user-scoped slot when configured. Format is "<phone>::<email>" with
    // a "::" separator (matching the bank id convention "paperclip::a::b").
    // When no user resolved, fall back to plain phone.
    //
    //// Neoffice Modification: whatsapp-voice-flag-in-origin-id
    //// Why: NORA #30 R-V15.22 — propagate the "user spoke" signal to the
    ////      runner via the originId suffix `::voice`. The runner parser
    ////      (parseOriginId in nora-agent-runner-core.mjs) splits on "::"
    ////      and detects the marker without any schema change. When voice
    ////      is set, the runner pipes its reply through Voxtral TTS and
    ////      sends a PTT note via the router /api/sendAudio endpoint, in
    ////      addition to the text reply (fallback for users who can't
    ////      listen right away or for whom synth fails).
    //// Date: 2026-05-08
    //// Refs: NORA [[30-whatsapp-media-tts/03-phase-tts-reply]]
    const voiceSuffix = body.is_audio ? "::voice" : "";
    const originId = userEmail
      ? `${body.phone}::${userEmail}${voiceSuffix}`
      : `${body.phone}${voiceSuffix}`;
    //// End Neoffice Modification: whatsapp-voice-flag-in-origin-id

    const issue = await ctx.issues.create({
      companyId: config.companyId,
      title,
      description,
      // `todo` (not the default `backlog`) so the issue is wakeable —
      // requestWakeup() rejects backlog/done/cancelled.
      status: "todo",
      assigneeAgentId: agentId,
      originKind: `plugin:${PLUGIN_ID}`,
      originId,
    });

    ctx.logger.info("issue created from whatsapp", {
      issueId: issue.id,
      phone: body.phone,
      agentId,
    });

    //// Neoffice Modification: whatsapp-cross-channel-user-thread-append
    //// Why: Phase R-V10 — write the inbound user message into the Frappe
    ////      cross-channel cache so Quick Chat / Mobile runs see this turn
    ////      in their next issue description (Phase R-V9 read path).
    //// R-V15.5 — fire-and-forget. Was awaited; under a slow Frappe this
    ////      was the second 30s+ blocker that pushed the whole RPC past
    ////      the 30s host timeout. The cache write is non-essential to
    ////      THIS run, only useful for the NEXT cross-channel turn — so
    ////      we let it land asynchronously and just log on failure.
    //// Refs: NORA [[27-paperclip-neoffice-embed/README]] Phase R-V10 + R-V15.5
    void appendUserThread(ctx, config, {
      canonicalId: userEmail,
      role: "user",
      content: messageText,
      channel: "whatsapp",
    }).catch((err) => {
      ctx.logger.warn("user_thread_append (user msg) failed (non-fatal)", {
        issueId: issue.id,
        error: String(err),
      });
    });
    //// End Neoffice Modification: whatsapp-cross-channel-user-thread-append

    //// R-V15.5 — wakeup is fire-and-forget too.
    //// Was awaited (sub-second on a healthy Paperclip), but on a saturated
    //// Postgres pool it occasionally pushed the RPC over budget. The agent
    //// runner picks up the issue from the heartbeat queue regardless of the
    //// caller awaiting the wakeup; awaiting only buys us the log line.
    void ctx.issues.requestWakeup(issue.id, config.companyId, {
      reason: "whatsapp_inbound",
      contextSource: `plugin:${PLUGIN_ID}`,
    }).then(() => {
      ctx.logger.info("wakeup requested for assignee", {
        issueId: issue.id,
        agentId,
      });
    }).catch((err) => {
      ctx.logger.warn("wakeup request failed (non-fatal)", {
        issueId: issue.id,
        error: String(err),
      });
    });

    // The webhook reply is built by Paperclip's plugin route handler
    // (server/src/routes/plugins.ts) which returns
    // `{ deliveryId, status: "success" }` once this handler resolves
    // without throwing. The agent runner sends the actual reply async via
    // the sendText tool — the WhatsApp router is taught to recognise the
    // queued ack and stay silent (NORA #27 R-V15.3,
    // //// Neoffice Modification: nora-router-skip-instance-down-on-queued).
  },
});

export default plugin;

// Bind the plugin to the host RPC channel. Required — without this call the
// worker process exits immediately after module evaluation (code=0) and the
// host reports `Worker initialize failed`.
runWorker(plugin, import.meta.url);
