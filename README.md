# @bvisible/paperclip-plugin-whatsapp

WhatsApp plugin for Paperclip — talks to a custom Baileys-based router on neoservice (NORA Phase 2, Chemin 2). Receives inbound messages via Paperclip's native webhook surface, and exposes a `whatsapp_send` tool to agents for outbound replies.

## Overview

```
WhatsApp user
  | Baileys WebSocket
  v
whatsapp-router (Node + @whiskeysockets/baileys 6.7.16) bound to a single
WhatsApp Business number on a central host.
  | POST /api/plugins/paperclip-plugin-whatsapp/webhooks/inbox
  | (auth: X-Relay-Token = instance_api_key)
  v
This plugin (Paperclip worker on the receiving Frappe instance)
  | resolve_user_from_phone (Frappe local)
  | optional: voice transcription via Cohere Transcribe (URL legacy whisper.noraai.ch)
  | create Paperclip Issue, assign agent
  v
Agent run (Hindsight + nora-frappe-tools)
  | tool whatsapp_send(phone, text)
  | POST {router}/api/sendText (auth: Bearer ROUTER_API_KEY)
  v
Baileys -> WhatsApp user
```

## Install

```bash
pnpm paperclipai plugin install @bvisible/paperclip-plugin-whatsapp
```

The plugin is a private package on the bvisible npm scope. The Paperclip server must have credentials for `@bvisible/*` (see your `.npmrc`).

## Configuration

Configure the plugin instance with the following fields (`pnpm paperclipai plugin configure`):

| Field | Required | Description |
| --- | --- | --- |
| `routerBaseUrl` | yes | Base URL of the central Baileys router (`https://neoservice.neoffice.me:3851`). |
| `routerApiKeyRef` | yes | Secret ref for the Bearer token of `POST /api/sendText`. |
| `webhookSecretRef` | yes | Secret ref for the `X-Relay-Token` header used by the router to authenticate webhook deliveries. Must match the `instance_api_key` registered in the routing table. |
| `frappeBaseUrl` | yes | URL of the local Frappe instance (Osiris/DMIS/...) used for `resolve_user_from_phone`. |
| `frappeRelayTokenRef` | yes | Secret ref for the `X-Relay-Token` used to call `nora.api.whatsapp_config.resolve_user_from_phone`. |
| `transcriptionUrl` | no | OpenAI-compatible transcription endpoint (default `https://whisper.noraai.ch/v1/audio/transcriptions`). |
| `transcriptionModel` | no | Model id (default `CohereLabs/cohere-transcribe-03-2026`). |
| `transcriptionLanguage` | no | Language hint (default `fr`). |
| `transcriptionApiKeyRef` | no | Secret ref for the Bearer token to the transcription endpoint. Required if voice notes are enabled. |
| `fallbackAgentId` | no | Agent ID to assign when the user has no explicit agent mapping (default `tools-v15`). |
| `companyId` | yes | Paperclip company UUID where WhatsApp issues should be created. |

## Webhook surface

The plugin exposes a single webhook endpoint:

- **Path**: `POST /api/plugins/paperclip-plugin-whatsapp/webhooks/inbox`
- **Auth**: `X-Relay-Token` header (must equal the configured `webhookSecretRef`).
- **Body** (JSON):

  ```json
  {
    "phone": "+41791234567",
    "message": "Bonjour Nora",
    "timestamp": "2026-05-02T16:45:32.000Z",
    "source": "whatsapp-router-v2",
    "is_audio": false,
    "files": []
  }
  ```

  When `is_audio: true`, the first entry in `files[]` is base64-encoded audio that the plugin transcribes via the configured transcription endpoint.

## Tool surface

Agents can call:

- **`whatsapp_send`** with `{ phone, text, replyTo? }` — sends a WhatsApp text via the router. Returns success or a typed error.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm run typecheck  # no-emit type check
```

The plugin targets ES2022, ESM, with `@paperclipai/plugin-sdk` >= 2026.428.

## License

MIT.
