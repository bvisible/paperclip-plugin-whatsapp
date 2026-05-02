import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "WhatsApp Bot (NORA)",
  description:
    "Receives WhatsApp messages forwarded by the central Baileys router (neoservice) and exposes a whatsapp_send tool to agents. Voice notes are transcribed via Cohere Transcribe (Olares).",
  author: "Bvisible",
  categories: ["connector", "automation"],
  capabilities: [
    "companies.read",
    "issues.read",
    "issues.create",
    "issue.comments.create",
    "agents.read",
    "agents.invoke",
    "events.subscribe",
    "events.emit",
    "plugin.state.read",
    "plugin.state.write",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "instance.settings.register",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      routerBaseUrl: {
        type: "string",
        title: "Router Base URL",
        description: "Base URL of the central Baileys router on neoservice.",
        default: DEFAULT_CONFIG.routerBaseUrl,
      },
      routerApiKeyRef: {
        type: "string",
        title: "Router API Key Secret Ref",
        description:
          "Secret ref for the Bearer token used to call POST /api/sendText on the router.",
      },
      webhookSecretRef: {
        type: "string",
        title: "Webhook Auth Secret Ref",
        description:
          "Secret ref for the X-Relay-Token used by the router to authenticate webhook deliveries to this plugin (= instance_api_key registered in the routing table).",
      },
      frappeBaseUrl: {
        type: "string",
        title: "Frappe Base URL (this instance)",
        description:
          "URL of the local Frappe instance — used to resolve phone -> user. Use http://127.0.0.1:8000 (direct gunicorn) when the plugin runs on the same VM as Frappe; combine with frappeSiteName so bench dispatches to the right site.",
        default: DEFAULT_CONFIG.frappeBaseUrl,
      },
      frappeSiteName: {
        type: "string",
        title: "Frappe Site Name",
        description:
          "Site name passed in the X-Frappe-Site-Name header when calling frappeBaseUrl directly (e.g. prod.local). Required when frappeBaseUrl is not the public domain.",
      },
      frappeRelayTokenRef: {
        type: "string",
        title: "Frappe Relay Token Secret Ref",
        description:
          "Secret ref for the X-Relay-Token used to call nora.api.whatsapp_config.resolve_user_from_phone on the local Frappe instance.",
      },
      transcriptionUrl: {
        type: "string",
        title: "Voice Transcription URL",
        description:
          "OpenAI-compatible endpoint for voice transcription (URL legacy whisper.noraai.ch — model is Cohere Transcribe).",
        default: DEFAULT_CONFIG.transcriptionUrl,
      },
      transcriptionModel: {
        type: "string",
        title: "Transcription Model",
        description: "Model id passed in the multipart form (Cohere Transcribe).",
        default: DEFAULT_CONFIG.transcriptionModel,
      },
      transcriptionLanguage: {
        type: "string",
        title: "Transcription Language Hint",
        description:
          "ISO 639-1 language hint passed to the transcription endpoint (default fr).",
        default: DEFAULT_CONFIG.transcriptionLanguage,
      },
      transcriptionApiKeyRef: {
        type: "string",
        title: "Transcription Bearer Secret Ref",
        description: "Secret ref for the Bearer token to whisper.noraai.ch.",
      },
      fallbackAgentId: {
        type: "string",
        title: "Fallback Agent ID",
        description:
          "Agent UUID to assign when the user has no explicit agent mapping. Should resolve to a 'main' or 'tools' agent.",
        default: DEFAULT_CONFIG.fallbackAgentId,
      },
      companyId: {
        type: "string",
        title: "Default Company ID",
        description:
          "Paperclip company UUID where WhatsApp issues are created (Neoffice Osiris by default).",
      },
    },
    required: [
      "routerBaseUrl",
      "routerApiKeyRef",
      "webhookSecretRef",
      "frappeBaseUrl",
      "frappeRelayTokenRef",
      "companyId",
    ],
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.inbox,
      displayName: "WhatsApp Inbox",
      description:
        "Receives WhatsApp messages forwarded by the neoservice Baileys router. Auth via X-Relay-Token header (= webhookSecretRef).",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.sendText,
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
              "Optional WhatsApp message ID to quote in the reply (chat continuity).",
          },
        },
        required: ["phone", "text"],
      },
    },
  ],
};

export default manifest;
