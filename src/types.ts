// Inbound payload from the neoservice Baileys router.
export interface RouterWebhookPayload {
  phone: string;
  message: string;
  timestamp: string;
  source?: string;
  is_audio?: boolean;
  files?: Array<{
    data: string;
    filename: string;
    mimetype: string;
  }>;
}

// Resolution result from `nora.api.whatsapp_config.resolve_user`.
// The Frappe endpoint returns the underlying NORA User Settings record:
//   { user, email, full_name, language, response_style, tts_enabled, tts_voice }
// `user` and `email` carry the Frappe user identifier (email-shaped). There is
// no per-user agent assignment yet — Phase 4 will introduce a mapping.
export interface FrappeUserResolution {
  user?: string;
  email?: string;
  full_name?: string;
  language?: string;
  response_style?: string;
  tts_enabled?: boolean;
  tts_voice?: string;
}

// Tool params for whatsapp_send.
export interface WhatsappSendParams {
  phone: string;
  text: string;
  replyTo?: string;
}

// Plugin instance config (raw, before secret resolution).
export interface PluginInstanceConfig {
  routerBaseUrl?: string;
  routerApiKeyRef?: string;
  webhookSecretRef?: string;
  frappeBaseUrl?: string;
  frappeSiteName?: string;
  frappeRelayTokenRef?: string;
  transcriptionUrl?: string;
  transcriptionModel?: string;
  transcriptionLanguage?: string;
  transcriptionApiKeyRef?: string;
  fallbackAgentId?: string;
  companyId?: string;
}

// Resolved config (secrets dereferenced).
export interface ResolvedConfig {
  routerBaseUrl: string;
  routerApiKey: string;
  webhookSecret: string;
  frappeBaseUrl: string;
  frappeSiteName: string;
  frappeRelayToken: string;
  transcriptionUrl: string;
  transcriptionModel: string;
  transcriptionLanguage: string;
  transcriptionApiKey: string;
  fallbackAgentId: string;
  companyId: string;
}
