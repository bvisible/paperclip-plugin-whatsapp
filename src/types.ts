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

// Resolution result from `nora.api.whatsapp_config.resolve_user_from_phone`.
export interface FrappeUserResolution {
  user_email?: string;
  user_name?: string;
  agent_id?: string;
  active?: boolean;
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
  frappeRelayToken: string;
  transcriptionUrl: string;
  transcriptionModel: string;
  transcriptionLanguage: string;
  transcriptionApiKey: string;
  fallbackAgentId: string;
  companyId: string;
}
