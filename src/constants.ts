export const PLUGIN_ID = "paperclip-plugin-whatsapp";
export const PLUGIN_VERSION = "0.1.0";

export const WEBHOOK_KEYS = {
  inbox: "inbox",
} as const;

export const TOOL_NAMES = {
  sendText: "whatsapp_send",
} as const;

export const DEFAULT_CONFIG = {
  routerBaseUrl: "https://neoservice.neoffice.me:3851",
  frappeBaseUrl: "https://osiris.neoffice.me",
  transcriptionUrl: "https://whisper.noraai.ch/v1/audio/transcriptions",
  transcriptionModel: "CohereLabs/cohere-transcribe-03-2026",
  transcriptionLanguage: "fr",
  fallbackAgentId: "tools-v15",
  whatsappIssueTitlePrefix: "WhatsApp",
  maxIssueTitleLength: 60,
} as const;

export const FRAPPE_RESOLVE_USER_PATH =
  "/api/method/nora.api.whatsapp_config.resolve_user";

export const ROUTER_SEND_TEXT_PATH = "/api/sendText";
