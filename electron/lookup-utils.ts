export function hasCjk(text: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

export function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function isLikelyEnglishSentence(text: string) {
  const normalized = normalizeWhitespace(text);
  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (wordCount < 2) return false;
  if (/[.!?]$/.test(normalized) || /[,;:]/.test(normalized)) return true;
  return /^(i|you|we|they|he|she|it|there|this|that|these|those)\b/i.test(normalized);
}

export function normalizeLookupKey(query: string, direction: "en-zh" | "zh-en") {
  const normalized = normalizeWhitespace(query);
  return direction === "en-zh" ? normalized.toLowerCase() : normalized;
}

export function stripLookupKey(query: string) {
  return normalizeLookupKey(query, "en-zh").replace(/[^a-z0-9]+/g, "");
}

export function slugifyEnglish(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u00c0-\u024f\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function compactLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
