import type { LookupResult } from "../src/shared";
import { lookupWithDeepSeek } from "./deepseek";
import { lookupLocalDictionary } from "./local-dictionary";
import { getLookupCache, setLookupCache } from "./store";
import { hasCjk, isLikelyEnglishSentence, normalizeLookupKey, normalizeWhitespace } from "./lookup-utils";

const cacheLimit = 1000;
const memoryCache = new Map<string, LookupResult>();
const inFlightLookups = new Map<string, Promise<LookupResult>>();

function now() {
  return new Date().toISOString();
}

function directionFor(query: string, direction?: "en-zh" | "zh-en") {
  return direction ?? (hasCjk(query) ? "zh-en" : "en-zh");
}

function cacheKey(query: string, direction: "en-zh" | "zh-en") {
  return `dictionary-v3:${direction}:${normalizeLookupKey(query, direction)}`;
}

function aiCacheKey(query: string, direction: "en-zh" | "zh-en") {
  return `dictionary-ai:${cacheKey(query, direction)}`;
}

function mergeLookupResults(base: LookupResult, supplement: LookupResult): LookupResult {
  const unique = (values: string[]) => Array.from(new Set(values.filter((value) => value.trim())));
  const senses = Array.from(
    new Map(
      [...base.senses, ...supplement.senses].map((sense) => [
        `${sense.partOfSpeech || ""}:${sense.meaning}:${sense.englishDefinition || ""}`,
        sense,
      ]),
    ).values(),
  );
  const examples = Array.from(
    new Map(
      [...base.examples, ...supplement.examples].map((example) => [
        `${example.english}:${example.chinese || ""}`,
        example,
      ]),
    ).values(),
  );
  return {
    ...base,
    ...supplement,
    headword: supplement.headword || base.headword,
    pronunciation: supplement.pronunciation || base.pronunciation,
    translation: supplement.translation || base.translation,
    senses,
    collocations: unique([...base.collocations, ...supplement.collocations]),
    examples,
    synonyms: unique([...(base.synonyms || []), ...(supplement.synonyms || [])]),
    alternatives: unique([...(base.alternatives || []), ...(supplement.alternatives || [])]),
    wordForms: unique([...(base.wordForms || []), ...(supplement.wordForms || [])]),
    sourceUrl: supplement.sourceUrl || base.sourceUrl,
    found: base.found || supplement.found,
  };
}

function remember(key: string, value: LookupResult) {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  while (memoryCache.size > cacheLimit) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

function notFound(query: string, direction: "en-zh" | "zh-en", message: string): LookupResult {
  return {
    query,
    normalizedQuery: normalizeLookupKey(query, direction),
    direction,
    senses: [],
    collocations: [],
    examples: [],
    alternatives: [],
    sourceUrl: "",
    source: "ai",
    found: false,
    message,
    cachedAt: now(),
  };
}

async function readPersistentCache(key: string) {
  try {
    return await getLookupCache(key);
  } catch {
    return null;
  }
}

function persistCache(key: string, result: LookupResult) {
  void setLookupCache(key, result).catch(() => undefined);
}

export async function lookupDictionary(input: {
  query: string;
  direction?: "en-zh" | "zh-en";
  context?: string;
}): Promise<LookupResult> {
  const query = normalizeWhitespace(input.query);
  const direction = directionFor(query, input.direction);
  if (!query) {
    return notFound("", direction, "请输入要查询的词或短语。");
  }

  const key = cacheKey(query, direction);
  const supplementKey = aiCacheKey(query, direction);
  const hot = memoryCache.get(key);
  if (hot) {
    remember(key, hot);
    return hot;
  }

  const pending = inFlightLookups.get(key);
  if (pending) return pending;

  const request = (async () => {
    const cachedPromise = Promise.all([
      readPersistentCache(key),
      readPersistentCache(supplementKey),
    ]);
    const localPromise =
      direction === "en-zh" && !isLikelyEnglishSentence(query)
        ? lookupLocalDictionary(query, direction).catch(() => null)
        : Promise.resolve(null);
    const [cached, supplement, local] = await Promise.all([cachedPromise, localPromise]).then(
      ([cacheValues, localResult]) => [cacheValues[0], cacheValues[1], localResult] as const,
    );

    if (local?.found) {
      const merged = supplement?.found
        ? mergeLookupResults(local, supplement)
        : cached?.source === "ai" && cached.found
          ? mergeLookupResults(local, cached)
          : local;
      remember(key, merged);
      persistCache(key, merged);
      return merged;
    }

    if (cached) {
      remember(key, cached);
      return cached;
    }
    if (supplement) {
      remember(key, supplement);
      return supplement;
    }

    try {
      const aiResult = await lookupWithDeepSeek({
        query,
        direction,
        context: input.context,
      });
      if (aiResult.found) {
        remember(key, aiResult);
        persistCache(key, aiResult);
      }
      return aiResult;
    } catch (error) {
      return notFound(
        query,
        direction,
        `本地词库未找到，AI 查询失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
  inFlightLookups.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightLookups.get(key) === request) {
      inFlightLookups.delete(key);
    }
  }
}

export async function enrichDictionary(input: {
  query: string;
  direction?: "en-zh" | "zh-en";
  context?: string;
  base?: LookupResult;
}): Promise<LookupResult> {
  const query = normalizeWhitespace(input.query);
  const direction = directionFor(query, input.direction);
  if (!query) {
    return notFound("", direction, "请输入要补充的词或短语。");
  }

  const key = aiCacheKey(query, direction);
  const cached = await readPersistentCache(key);
  if (cached) {
    remember(key, cached);
    const merged = input.base?.found ? mergeLookupResults(input.base, cached) : cached;
    remember(cacheKey(query, direction), merged);
    return merged;
  }

  try {
    const result = await lookupWithDeepSeek({
      query,
      direction,
      context: input.context,
      base: input.base,
    });
    if (result.found) {
      remember(key, result);
      persistCache(key, result);
      const merged = input.base?.found ? mergeLookupResults(input.base, result) : result;
      const primaryKey = cacheKey(query, direction);
      remember(primaryKey, merged);
      persistCache(primaryKey, merged);
      return merged;
    }
    return result;
  } catch (error) {
    return notFound(
      query,
      direction,
      `AI 补充失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
