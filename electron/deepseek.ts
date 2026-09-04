import type { ChatResponse, ConversationEnvironment, Correction, LookupResult } from "../src/shared";
import {
  appendChatMessage,
  createConversation,
  getApiKey,
  getAppSettings,
  getConversationMessages,
} from "./store";
import { isLikelyEnglishSentence } from "./lookup-utils";

type ModelPayload = {
  assistantReply: string;
  correction: Correction | null;
};

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function buildSystemPrompt(mode: "light" | "detailed", environment: ConversationEnvironment) {
  const detailRules =
    mode === "detailed"
      ? "When the user's English is unnatural, add short grammar, vocabulary, collocation, and tone notes in details. Give 2-4 alternatives when useful."
      : "Keep the correction concise. Explain only the most important issue.";
  const environmentRules: Record<ConversationEnvironment, string> = {
    casual:
      "The setting is relaxed daily conversation. Prefer natural spoken English, contractions, friendly wording, and common phrasal verbs. Do not over-correct harmless informal expressions.",
    serious:
      "The setting is serious and formal. Prefer precise, respectful, complete sentences. Flag slang, casual shortcuts, and wording that could sound careless or overly familiar.",
    work:
      "The setting is professional workplace communication. Prefer clear, tactful, concise wording suitable for colleagues, meetings, email, and business discussions. Explain politeness and professional tone when relevant.",
    academic:
      "The setting is academic or presentation-oriented. Prefer precise, structured, evidence-friendly language. Flag vague wording, unsupported claims, and overly casual expressions when relevant.",
    travel:
      "The setting is travel and service interaction. Prefer practical, polite, easy-to-understand spoken English for hotels, restaurants, transport, and asking for help.",
  };

  return [
    "You are a friendly English speaking coach for a Chinese learner.",
    "Reply to the FINAL user message only; do not continue or answer an earlier turn instead.",
    "Reply in natural English first, then analyze that same final user message.",
    environmentRules[environment],
    "Return valid JSON only with this shape:",
    '{ "assistantReply": string, "correction": { "original": string, "recommended": string, "reason": string, "details"?: string[], "alternatives"?: string[] } | null }',
    "If correction is not null, correction.original must exactly reproduce the FINAL user message, including all words; never use text from an earlier turn.",
    detailRules,
    "If the user's English is already natural, set correction to null.",
    "Do not include markdown fences or any extra text.",
  ].join(" ");
}

function normalizeChatText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function validateChatPayload(payload: ModelPayload, latestUserMessage: string): ModelPayload {
  const assistantReply = payload.assistantReply.trim();
  const correction = payload.correction;
  if (!assistantReply) {
    throw new Error("AI 返回了空回复。");
  }

  if (!correction || typeof correction !== "object") {
    return { assistantReply, correction: null };
  }

  const original = typeof correction.original === "string" ? correction.original.trim() : "";
  const recommended = typeof correction.recommended === "string" ? correction.recommended.trim() : "";
  const reason = typeof correction.reason === "string" ? correction.reason.trim() : "";
  if (!original || !recommended || !reason) {
    return { assistantReply, correction: null };
  }

  if (normalizeChatText(original) !== normalizeChatText(latestUserMessage)) {
    return { assistantReply, correction: null };
  }

  return {
    assistantReply,
    correction: {
      original,
      recommended,
      reason,
      details: Array.isArray(correction.details)
        ? correction.details.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
      alternatives: Array.isArray(correction.alternatives)
        ? correction.alternatives.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
    },
  };
}

function safeParseJson(content: string): ModelPayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0) candidates.push(trimmed.slice(firstBrace));
  if (lastBrace >= 0) candidates.push(trimmed.slice(0, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ModelPayload>;
      if (typeof parsed.assistantReply === "string") {
        return {
          assistantReply: parsed.assistantReply,
          correction: parsed.correction ?? null,
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function fallbackCorrection(content: string): Correction | null {
  if (!content.trim()) return null;
  return null;
}

async function callDeepSeek(
  model: string,
  baseUrl: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number; retries?: number } = {},
) {
  const retries = Math.max(0, options.retries ?? 1);
  const timeoutMs = Math.max(3000, options.timeoutMs ?? 12000);
  let lastError: unknown;
  let useJsonResponseFormat = true;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 800,
          ...(useJsonResponseFormat ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const error = new Error(
          `DeepSeek 请求失败：${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
        ) as Error & { retryable?: boolean };
        error.retryable = retryable;
        if (
          useJsonResponseFormat &&
          (response.status === 400 || response.status === 404 || response.status === 422) &&
          /response[_ -]?format|json[_ -]?object|unsupported/i.test(text)
        ) {
          useJsonResponseFormat = false;
          lastError = error;
          continue;
        }
        if (!retryable || attempt >= retries) throw error;
        lastError = error;
      } else {
        return response.json() as Promise<{
          choices?: Array<{
            message?: { content?: unknown; reasoning_content?: unknown };
          }>;
        }>;
      }
    } catch (error) {
      const retryable = !(error instanceof Error && "retryable" in error && error.retryable === false);
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? new Error(`DeepSeek 请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
          : error;
      if (!retryable || attempt >= retries) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }

  throw lastError instanceof Error ? lastError : new Error("DeepSeek 请求失败");
}

type DictionaryModelPayload = {
  found?: boolean;
  headword?: string;
  pronunciation?: string;
  translation?: string;
  senses?: Array<{
    partOfSpeech?: string;
    label?: string;
    meaning?: string;
    englishDefinition?: string;
  }>;
  collocations?: string[];
  examples?: Array<{ english?: string; chinese?: string }>;
  synonyms?: string[];
  alternatives?: string[];
  confidence?: number;
  message?: string;
};

function parseJsonObject(content: string): DictionaryModelPayload | null {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "string") {
        const nested: DictionaryModelPayload | null = parseJsonObject(parsed);
        if (nested) return nested;
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const wrapped = record.data || record.result || record.output;
        if (wrapped && typeof wrapped === "object") return wrapped as DictionaryModelPayload;
        return parsed as DictionaryModelPayload;
      }
    } catch {
      try {
        const repaired = candidate
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'");
        const parsed = JSON.parse(repaired) as unknown;
        if (parsed && typeof parsed === "object") return parsed as DictionaryModelPayload;
      } catch {
        // try another candidate
      }
    }
  }
  return null;
}

function extractMessageContent(message: { content?: unknown; reasoning_content?: unknown } | undefined) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  return typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function asString(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
}

function buildDictionarySystemPrompt() {
  return [
    "You are a precise English-Chinese dictionary and usage assistant for a Chinese learner.",
    "Return valid JSON only. Never claim Collins, Oxford, or any dictionary source.",
    "For English input, explain every common meaning and part of speech, then give concise Chinese meanings and English definitions.",
    "If the English query is a complete sentence, return its direct, natural Chinese translation in translation, set senses to an empty array, and do not treat the sentence only as a dictionary headword.",
    "For Chinese input, provide natural English translations and alternatives suitable for speaking practice.",
    "If a base dictionary result is supplied, keep its meaning and focus on concise missing examples, collocations, synonyms, and alternatives.",
    "Use the supplied context to disambiguate meaning. Do not invent rare meanings.",
    "Keep examples natural and short. Return no markdown fences.",
    JSON.stringify({
      found: true,
      headword: "string",
      pronunciation: "string",
      translation: "完整英文句子的自然中文译文；非句子可留空",
      senses: [{ partOfSpeech: "string", label: "string", meaning: "string", englishDefinition: "string" }],
      collocations: ["string"],
      examples: [{ english: "string", chinese: "string" }],
      synonyms: ["string"],
      alternatives: ["string"],
      confidence: 0.92,
      message: "string",
    }),
  ].join(" ");
}

function normalizeDictionaryPayload(
  query: string,
  direction: "en-zh" | "zh-en",
  payload: DictionaryModelPayload,
  providerLatencyMs: number,
): LookupResult {
  const senses = (Array.isArray(payload.senses) ? payload.senses : [])
    .map((sense) => ({
      partOfSpeech: typeof sense.partOfSpeech === "string" ? sense.partOfSpeech : undefined,
      label: typeof sense.label === "string" ? sense.label : undefined,
      meaning: typeof sense.meaning === "string" ? sense.meaning.trim() : "",
      englishDefinition:
        typeof sense.englishDefinition === "string" ? sense.englishDefinition.trim() : undefined,
    }))
    .filter((sense) => sense.meaning.length > 0);
  const alternatives = asStringArray(payload.alternatives);
  const synonyms = asStringArray(payload.synonyms);
  const translation = asString(payload.translation);
  const examples = (Array.isArray(payload.examples) ? payload.examples : [])
    .filter((example) => example && typeof example.english === "string" && example.english.trim().length > 0)
    .map((example) => ({
      english: example.english!.trim(),
      chinese: typeof example.chinese === "string" ? example.chinese.trim() : undefined,
    }))
    .slice(0, 8);
  const collocations = asStringArray(payload.collocations).slice(0, 12);
  const found = Boolean(
    translation ||
      senses.length ||
      collocations.length ||
      synonyms.length ||
      alternatives.length ||
      examples.length ||
      (typeof payload.headword === "string" && payload.headword.trim()),
  );

  return {
    query,
    normalizedQuery: query.trim(),
    direction,
    headword: typeof payload.headword === "string" ? payload.headword.trim() || undefined : undefined,
    pronunciation:
      typeof payload.pronunciation === "string" ? payload.pronunciation.trim() || undefined : undefined,
    translation,
    senses,
    collocations,
    examples,
    synonyms: synonyms.slice(0, 12),
    alternatives: alternatives.slice(0, 12),
    sourceUrl: "",
    source: "ai",
    found,
    confidence: typeof payload.confidence === "number" ? Math.max(0, Math.min(1, payload.confidence)) : undefined,
    message: typeof payload.message === "string" ? payload.message.trim() || undefined : undefined,
    cachedAt: new Date().toISOString(),
    providerLatencyMs,
  };
}

export async function lookupWithDeepSeek(input: {
  query: string;
  direction: "en-zh" | "zh-en";
  context?: string;
  base?: LookupResult;
}): Promise<LookupResult> {
  const startedAt = Date.now();
  const settings = await getAppSettings();
  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      query: input.query,
      normalizedQuery: input.query.trim(),
      direction: input.direction,
      senses: [],
      collocations: [],
      examples: [],
      alternatives: [],
      sourceUrl: "",
      source: "ai",
      found: false,
      message: "本地词库未找到。请先在设置中填写 DeepSeek 密钥，才能查询未收录词组。",
      cachedAt: new Date().toISOString(),
      providerLatencyMs: Date.now() - startedAt,
    };
  }

  const payload = await callDeepSeek(
    settings.model,
    settings.baseUrl,
    apiKey,
    [
      { role: "system", content: buildDictionarySystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          query: input.query,
          direction: input.direction,
          inputKind:
            input.direction === "en-zh"
              ? isLikelyEnglishSentence(input.query)
                ? "sentence"
                : input.query.trim().includes(" ")
                  ? "phrase"
                  : "word"
              : "chinese",
          context: input.context || "",
          base: input.base || null,
        }),
      },
    ],
    {
      temperature: 0.15,
      maxTokens: input.base ? 900 : 1000,
      timeoutMs: 9000,
      retries: 1,
    },
  );
  const rawContent = extractMessageContent(payload.choices?.[0]?.message);
  const parsed = parseJsonObject(rawContent);
  if (!parsed) {
    const looksLikeSentence =
      input.direction === "en-zh" && input.query.trim().split(/\s+/).filter(Boolean).length >= 3;
    if (looksLikeSentence && rawContent.trim()) {
      return {
        query: input.query,
        normalizedQuery: input.query.trim(),
        direction: input.direction,
        translation: rawContent.trim().replace(/^["'`]+|["'`]+$/g, ""),
        senses: [],
        collocations: [],
        examples: [],
        alternatives: [],
        sourceUrl: "",
        source: "ai",
        found: true,
        message: "AI 返回了直接译文。",
        cachedAt: new Date().toISOString(),
        providerLatencyMs: Date.now() - startedAt,
      };
    }
    return {
      query: input.query,
      normalizedQuery: input.query.trim(),
      direction: input.direction,
      senses: [],
      collocations: [],
      examples: [],
      alternatives: [],
      sourceUrl: "",
      source: "ai",
      found: false,
      message: "AI 返回格式无法解析，请稍后重试。",
      cachedAt: new Date().toISOString(),
      providerLatencyMs: Date.now() - startedAt,
    };
  }
  return normalizeDictionaryPayload(input.query, input.direction, parsed, Date.now() - startedAt);
}

async function buildHistory(conversationId: string) {
  const messages = await getConversationMessages(conversationId);
  return messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export async function sendChatMessage(input: {
  conversationId?: string;
  content: string;
  correctionMode: "light" | "detailed";
  environment: ConversationEnvironment;
}): Promise<ChatResponse & { conversationId: string; assistantText: string }> {
  const settings = await getAppSettings();
  const apiKey = await getApiKey();
  const conversationId = input.conversationId || (await createConversation()).id;
  const userMessage = await appendChatMessage(conversationId, "user", input.content, null);

  if (!apiKey) {
    const assistant = await appendChatMessage(
      conversationId,
      "assistant",
      "请先在设置中填写 DeepSeek 密钥后再开始练习。",
      null,
    );
    return {
      conversationId,
      message: assistant,
      correction: null,
      assistantText: assistant.content,
    };
  }

  try {
    const history = await buildHistory(conversationId);
    const payload = await callDeepSeek(settings.model, settings.baseUrl, apiKey, [
      { role: "system", content: buildSystemPrompt(input.correctionMode, input.environment) },
      ...history.slice(0, -1),
      {
        role: "user",
        content: [
          "FINAL_USER_MESSAGE_TO_ANSWER:",
          input.content,
          "Answer this message now. Do not answer an earlier message.",
        ].join("\\n"),
      },
    ], {
      temperature: 0.25,
      maxTokens: 1200,
      timeoutMs: 12000,
      retries: 1,
    });
    const rawContent = extractMessageContent(payload.choices?.[0]?.message);
    const parsed = safeParseJson(rawContent);
    if (!parsed) {
      throw new Error(rawContent.trim() ? "AI 返回格式无法解析。" : "AI 返回了空回复。");
    }
    const validated = validateChatPayload(parsed, input.content);
    const assistant = await appendChatMessage(
      conversationId,
      "assistant",
      validated.assistantReply,
      validated.correction,
    );
    return {
      conversationId,
      message: assistant,
      correction: validated.correction,
      assistantText: validated.assistantReply,
    };
  } catch (error) {
    const assistant = await appendChatMessage(
      conversationId,
      "assistant",
      `DeepSeek 连接出错：${error instanceof Error ? error.message : String(error)}`,
      null,
    );
    return {
      conversationId,
      message: assistant,
      correction: null,
      assistantText: assistant.content,
    };
  }
}

export async function testDeepSeekConnection() {
  const settings = await getAppSettings();
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, message: "未检测到 DeepSeek 密钥。" };
  }
  try {
    await callDeepSeek(settings.model, settings.baseUrl, apiKey, [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: "ping" },
    ]);
    return { ok: true, message: "连接成功。" };
  } catch (error) {
    return {
      ok: false,
      message: `DeepSeek 连接失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
