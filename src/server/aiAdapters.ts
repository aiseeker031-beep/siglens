import net from 'node:net';
import type { AIProviderType } from '../shared/types';

export interface AIInvokeRequest {
  providerType: AIProviderType;
  model: string;
  baseUrl: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
}

const DEFAULT_BASE_URLS: Record<AIProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  openai_compatible: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://127.0.0.1:11434',
};

/**
 * SSRF protection: blocks private/loopback/link-local hosts except explicit local Ollama
 * when running in development mode.
 */
export function validateProviderBaseUrl(rawUrl: string, providerType: AIProviderType): URL {
  const effective = (rawUrl || DEFAULT_BASE_URLS[providerType]).trim();
  let parsed: URL;
  try {
    parsed = new URL(effective);
  } catch {
    throw new Error('Invalid AI provider base URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider URL must use HTTP or HTTPS.');
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  if (providerType === 'ollama') {
    if (process.env.NODE_ENV === 'production' && isLocalhost && process.env.ALLOW_LOCAL_OLLAMA !== 'true') {
      throw new Error('Local Ollama access is restricted to local development unless ALLOW_LOCAL_OLLAMA=true.');
    }
    return parsed;
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('External AI providers must use HTTPS.');
  }

  // Block metadata IPs and RFC1918 / link-local addresses
  if (
    isLocalhost ||
    host === 'metadata.google.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Private or internal network URLs are blocked for security.');
  }

  if (net.isIP(host)) {
    const parts = host.split('.').map(Number);
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    ) {
      throw new Error('Private IP ranges are blocked for security.');
    }
  }

  return parsed;
}

/**
 * Invokes the configured BYOK AI provider using its native protocol format.
 * Never logs API keys or echoes secrets.
 */
export async function invokeAIProvider(req: AIInvokeRequest): Promise<{ text: string; modelUsed: string }> {
  const baseUrl = validateProviderBaseUrl(req.baseUrl, req.providerType);
  const baseClean = baseUrl.toString().replace(/\/+$/, '');
  const timeout = Math.min(Math.max(req.timeoutMs || 25_000, 3_000), 60_000);

  if (req.providerType !== 'ollama' && (!req.apiKey || req.apiKey.trim().length < 4)) {
    throw new Error('An API key is required for this provider.');
  }

  // 1. Anthropic Messages API
  if (req.providerType === 'anthropic') {
    const res = await fetch(`${baseClean}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens || 1024,
        temperature: req.temperature,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API returned HTTP ${res.status}. Verify model name and credentials.`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; model?: string };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
    return { text: text || 'No response text returned.', modelUsed: data.model || req.model };
  }

  // 2. Google Gemini REST API
  if (req.providerType === 'gemini') {
    const url = `${baseClean}/models/${encodeURIComponent(req.model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey!,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens || 1024,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API returned HTTP ${res.status}. Verify model ID and API key.`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') ||
      'No response text returned.';
    return { text, modelUsed: req.model };
  }

  // 3. Ollama local API
  if (req.providerType === 'ollama') {
    const res = await fetch(`${baseClean}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        options: { temperature: req.temperature, num_predict: req.maxTokens || 1024 },
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned HTTP ${res.status}. Ensure Ollama is running locally and the model is pulled.`);
    }
    const data = (await res.json()) as { message?: { content?: string }; model?: string };
    return { text: data.message?.content || 'No response returned.', modelUsed: data.model || req.model };
  }

  // 4. OpenAI, Groq, and OpenAI-Compatible Chat Completions API
  const res = await fetch(`${baseClean}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      temperature: req.temperature,
      max_tokens: req.maxTokens || 1024,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Provider API returned HTTP ${res.status}. Verify endpoint, model name, and API key.`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };
  return {
    text: data.choices?.[0]?.message?.content || 'No response returned.',
    modelUsed: data.model || req.model,
  };
}
