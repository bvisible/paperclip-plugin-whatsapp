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

//// Neoffice Modification: whatsapp-cross-channel-user-thread-append
//// Why: NORA #27 Phase R-V10. WhatsApp issues bypass Frappe send(), so
////      they must POST inbound messages to nora.api.v2.chat.user_thread_append
////      so the cross-channel cache used by Quick Chat / Mobile sees them.
//// Date: 2026-05-05
//// Refs: NORA [[27-paperclip-neoffice-embed/README]] Phase R-V10
export const FRAPPE_USER_THREAD_APPEND_PATH =
  "/api/method/nora.api.v2.chat.user_thread_append";
export const FRAPPE_USER_THREAD_GET_PATH =
  "/api/method/nora.api.v2.chat.user_thread_get";
//// End Neoffice Modification: whatsapp-cross-channel-user-thread-append

//// Neoffice Modification: whatsapp-document-scan-from-media
//// Why: NORA #30 R-V15.21 — image/PDF reçus via WhatsApp doivent
////      déclencher la chaîne OCR Document Scan (sinon ignorés).
//// Date: 2026-05-08
//// Refs: NORA [[30-whatsapp-media-tts/02-phase-image-pdf]]
export const FRAPPE_UPLOAD_AND_SCAN_PATH =
  "/api/method/nora.api.ocr.upload_and_scan_from_relay";
//// End Neoffice Modification: whatsapp-document-scan-from-media

export const ROUTER_SEND_TEXT_PATH = "/api/sendText";

//// Neoffice Modification: nora-router-send-audio
//// Why: NORA #30 R-V15.22 — vocal-in/vocal-out WhatsApp.
//// Date: 2026-05-08
export const ROUTER_SEND_AUDIO_PATH = "/api/sendAudio";
//// End Neoffice Modification: nora-router-send-audio
