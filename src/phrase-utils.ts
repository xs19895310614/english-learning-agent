const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

function cleanToken(token: string) {
  return token
    .trim()
    .replace(/^[^\p{L}\p{N}\u4e00-\u9fff']+|[^\p{L}\p{N}\u4e00-\u9fff']+$/gu, "")
    .trim()
    .toLowerCase();
}

function extractWords(text: string) {
  return Array.from(text.matchAll(WORD_PATTERN), (match) => match[0]);
}

export function extractRelatedPhrases(text: string, token: string, limit = 6) {
  const target = cleanToken(token);
  if (!target || !text.trim()) return [];

  const words = extractWords(text);
  if (words.length < 2) return [];

  const normalizedWords = words.map((word) => cleanToken(word));
  const candidates = new Map<string, { phrase: string; size: number; start: number }>();

  normalizedWords.forEach((word, index) => {
    if (word !== target) return;

    for (let size = 2; size <= 4; size += 1) {
      const startMin = Math.max(0, index - size + 1);
      const startMax = Math.min(index, words.length - size);
      for (let start = startMin; start <= startMax; start += 1) {
        const phraseWords = words.slice(start, start + size);
        const phrase = phraseWords.join(" ").trim();
        const key = phrase.toLowerCase();
        if (!phrase || key === target || candidates.has(key)) continue;
        candidates.set(key, { phrase, size: phraseWords.length, start });
      }
    }
  });

  return Array.from(candidates.values())
    .sort((a, b) => a.size - b.size || a.start - b.start || a.phrase.localeCompare(b.phrase))
    .slice(0, limit)
    .map((item) => item.phrase);
}
