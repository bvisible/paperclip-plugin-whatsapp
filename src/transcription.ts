import { Buffer } from "node:buffer";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { ResolvedConfig } from "./types.js";

/**
 * Transcribe an audio file (base64-encoded) via the Olares endpoint.
 * URL is legacy `whisper.noraai.ch` but the model dispatched is Cohere
 * Transcribe (`CohereLabs/cohere-transcribe-03-2026` since 2026-04-02).
 */
export async function transcribeAudio(
  ctx: PluginContext,
  config: ResolvedConfig,
  audioBase64: string,
  mimetype: string,
): Promise<string | null> {
  if (!config.transcriptionApiKey) {
    ctx.logger.warn(
      "transcription api key missing — skipping audio transcription",
    );
    return null;
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioBuffer], { type: mimetype || "audio/ogg" }),
      "audio.ogg",
    );
    formData.append("model", config.transcriptionModel);
    if (config.transcriptionLanguage) {
      formData.append("language", config.transcriptionLanguage);
    }

    const response = await ctx.http.fetch(config.transcriptionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.transcriptionApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      ctx.logger.error("transcription failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = (await response.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) {
      return null;
    }
    return (
      text
        .replace(/\[.*?\]/g, "")
        .replace(/\(.*?\)/g, "")
        .trim() || null
    );
  } catch (err) {
    ctx.logger.error("transcription error", {
      err: (err as Error).message,
    });
    return null;
  }
}
