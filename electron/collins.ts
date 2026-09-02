import { BrowserWindow } from "electron";
import type { Example, LookupResult, Sense } from "../src/shared";
import {
  compactLines,
  hasCjk,
  normalizeLookupKey,
  normalizeWhitespace,
  slugifyEnglish,
  unique,
} from "./lookup-utils";
import { getLookupCache, setLookupCache } from "./store";

type PageSnapshot = {
  title: string;
  text: string;
  url: string;
  html: string;
};

const collinsPartition = "persist:collins";
const collinsHomeUrl = "https://www.collinsdictionary.com/";

type LocalEntry = {
  headword: string;
  pronunciation?: string;
  senses: Sense[];
  collocations?: string[];
  examples?: Example[];
};

const localFallbackEntries: Record<string, LocalEntry> = {
  hello: {
    headword: "hello",
    pronunciation: "heh-LOH",
    senses: [
      {
        partOfSpeech: "interjection",
        meaning: "你好；喂",
        englishDefinition: "used as a greeting or to begin a conversation",
      },
    ],
    collocations: ["say hello", "hello there"],
    examples: [{ english: "Hello, nice to meet you.", chinese: "你好，很高兴见到你。" }],
  },
  practice: {
    headword: "practice",
    pronunciation: "PRAK-tis",
    senses: [
      {
        partOfSpeech: "noun",
        meaning: "练习；实践",
        englishDefinition: "repeated activity done to improve a skill",
      },
      {
        partOfSpeech: "verb",
        meaning: "练习；训练",
        englishDefinition: "to do an activity repeatedly so that you become better at it",
      },
    ],
    collocations: ["practice speaking", "daily practice", "put into practice"],
    examples: [{ english: "I practice English for twenty minutes every day.", chinese: "我每天练二十分钟英语。" }],
  },
  improve: {
    headword: "improve",
    pronunciation: "im-PROOV",
    senses: [
      {
        partOfSpeech: "verb",
        meaning: "改善；提高；进步",
        englishDefinition: "to become better or to make something better",
      },
    ],
    collocations: ["improve quickly", "improve your pronunciation", "improve over time"],
    examples: [{ english: "My speaking improves when I talk more often.", chinese: "我说得越多，口语就越进步。" }],
  },
  natural: {
    headword: "natural",
    pronunciation: "NACH-er-uhl",
    senses: [
      {
        partOfSpeech: "adjective",
        meaning: "自然的；地道的",
        englishDefinition: "normal and not forced; suitable for the situation",
      },
    ],
    collocations: ["sound natural", "natural expression", "natural conversation"],
    examples: [{ english: "This sentence sounds more natural.", chinese: "这个句子听起来更地道。" }],
  },
  expression: {
    headword: "expression",
    pronunciation: "ik-SPRESH-uhn",
    senses: [
      {
        partOfSpeech: "noun",
        meaning: "表达；说法；词语",
        englishDefinition: "a word or phrase used to say something",
      },
    ],
    collocations: ["useful expression", "common expression", "natural expression"],
    examples: [{ english: "That is a useful expression in everyday English.", chinese: "那是日常英语里很有用的表达。" }],
  },
  fluent: {
    headword: "fluent",
    pronunciation: "FLOO-uhnt",
    senses: [
      {
        partOfSpeech: "adjective",
        meaning: "流利的",
        englishDefinition: "able to speak or write a language easily and well",
      },
    ],
    collocations: ["fluent English", "become fluent", "speak fluently"],
    examples: [{ english: "I want to become more fluent in English.", chinese: "我想让英语更流利。" }],
  },
  pronunciation: {
    headword: "pronunciation",
    pronunciation: "pruh-nun-see-AY-shuhn",
    senses: [
      {
        partOfSpeech: "noun",
        meaning: "发音",
        englishDefinition: "the way in which a word is spoken",
      },
    ],
    collocations: ["clear pronunciation", "improve pronunciation", "pronunciation practice"],
    examples: [{ english: "Your pronunciation is clear.", chinese: "你的发音很清楚。" }],
  },
  vocabulary: {
    headword: "vocabulary",
    pronunciation: "voh-KAB-yuh-ler-ee",
    senses: [
      {
        partOfSpeech: "noun",
        meaning: "词汇；词汇量",
        englishDefinition: "all the words that someone knows or uses",
      },
    ],
    collocations: ["build vocabulary", "active vocabulary", "useful vocabulary"],
    examples: [{ english: "Reading helps me build my vocabulary.", chinese: "阅读帮助我扩大词汇量。" }],
  },
  "how are you": {
    headword: "how are you",
    senses: [
      {
        partOfSpeech: "phrase",
        meaning: "你好吗；最近怎么样",
        englishDefinition: "used to ask about someone's health or situation",
      },
    ],
    collocations: ["How are you doing?", "How have you been?"],
    examples: [{ english: "How are you doing today?", chinese: "你今天怎么样？" }],
  },
  你好: {
    headword: "你好",
    senses: [
      {
        partOfSpeech: "phrase",
        meaning: "hello; hi",
        englishDefinition: "a greeting used when meeting someone",
      },
    ],
    examples: [{ english: "Hello, nice to meet you.", chinese: "你好，很高兴见到你。" }],
  },
  词典: {
    headword: "词典",
    pronunciation: "ci dian",
    senses: [
      {
        partOfSpeech: "noun",
        meaning: "dictionary",
        englishDefinition: "a book or online resource that explains words and meanings",
      },
    ],
    examples: [{ english: "I looked it up in a dictionary.", chinese: "我在词典里查了它。" }],
  },
  练习: {
    headword: "练习",
    pronunciation: "lian xi",
    senses: [
      {
        partOfSpeech: "verb / noun",
        meaning: "practice; exercise",
        englishDefinition: "to repeat an activity in order to improve",
      },
    ],
    examples: [{ english: "I need more speaking practice.", chinese: "我需要更多口语练习。" }],
  },
  地道: {
    headword: "地道",
    pronunciation: "di dao",
    senses: [
      {
        partOfSpeech: "adjective",
        meaning: "natural; idiomatic",
        englishDefinition: "used to describe language that sounds normal to native speakers",
      },
    ],
    examples: [{ english: "This sounds more natural.", chinese: "这听起来更地道。" }],
  },
};

function now() {
  return new Date().toISOString();
}

function baseNotFound(query: string, direction: "en-zh" | "zh-en", url: string, message: string): LookupResult {
  return {
    query,
    normalizedQuery: normalizeLookupKey(query, direction),
    direction,
    senses: [],
    collocations: [],
    examples: [],
    sourceUrl: url,
    source: "collins",
    found: false,
    message,
    cachedAt: now(),
  };
}

function isChallengePage(snapshot: PageSnapshot) {
  const text = `${snapshot.title}\n${snapshot.text}`;
  return /Just a moment|Enable JavaScript and cookies|Checking your browser|cf-chl|Cloudflare/i.test(text);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]);
}

function localFallback(query: string, direction: "en-zh" | "zh-en", reason: string): LookupResult | null {
  const normalized = normalizeLookupKey(query, direction);
  const entry = localFallbackEntries[normalized];
  if (!entry) return null;
  return {
    query,
    normalizedQuery: normalized,
    direction,
    headword: entry.headword,
    pronunciation: entry.pronunciation,
    senses: entry.senses,
    collocations: entry.collocations ?? [],
    examples: entry.examples ?? [],
    sourceUrl: "",
    source: "local-fallback",
    found: true,
    message: `Collins 官网暂时不可用，当前显示本地应急释义。原因：${reason}`,
    cachedAt: now(),
  };
}

function guessDirection(query: string): "en-zh" | "zh-en" {
  return hasCjk(query) ? "zh-en" : "en-zh";
}

function cleanTitle(title: string) {
  return title.replace(/\s*\|\s*Collins.*$/i, "").trim();
}

function parseHeadwordFromTitle(title: string) {
  const clean = cleanTitle(title);
  const match = clean.match(/^(.+?)\s+definition and meaning$/i);
  return (match?.[1] ?? clean).trim();
}

function splitBilingualLine(line: string) {
  const index = line.search(/[A-Za-z]/);
  if (index <= 0) {
    return { chinese: "", english: line.trim() };
  }
  const before = line.slice(0, index).trim();
  const english = line.slice(index).trim();
  if (before && /[\u4e00-\u9fff]/.test(before)) {
    return { chinese: before, english };
  }
  return { chinese: "", english: line.trim() };
}

function looksLikeExample(line: string) {
  return (
    line.length > 8 &&
    /[.!?。！？]$/.test(line) &&
    /[A-Za-z]/.test(line) &&
    !/^(British English|American English|Chinese|COBUILD|In other languages)/i.test(line)
  );
}

function extractSection(lines: string[], headingText: string, stopPrefixes: string[]) {
  const index = lines.findIndex((line) => line.includes(headingText));
  if (index < 0) return [];
  const collected: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (stopPrefixes.some((prefix) => line.startsWith(prefix))) break;
    if (line) collected.push(line);
  }
  return collected;
}

function parseEnglishBlocks(lines: string[]): { headword?: string; pronunciation?: string; senses: Sense[]; examples: Example[] } {
  const indices = lines
    .map((line, index) => (line.includes("British English:") ? index : -1))
    .filter((index) => index >= 0);
  const senses: Sense[] = [];
  const examples: Example[] = [];
  let headword: string | undefined;
  let pronunciation: string | undefined;

  for (let blockIndex = 0; blockIndex < indices.length; blockIndex += 1) {
    const start = indices[blockIndex];
    const end = blockIndex + 1 < indices.length ? indices[blockIndex + 1] : lines.length;
    const block = lines.slice(start, end);
    const header = block[0];
    const rawHeader = header.replace(/^.*British English:\s*/, "").trim();
    const blockPronunciation = rawHeader.match(/\/([^/]+)\//)?.[1]?.trim();
    const headerWithoutPronunciation = rawHeader.replace(/\/[^/]+\//, "").trim();
    const posMatch = headerWithoutPronunciation.match(
      /\b(NOUN|VERB|ADJECTIVE|ADVERB|PRONOUN|PREPOSITION|CONJUNCTION|INTERJECTION|PHRASE)\b/i,
    );
    const partOfSpeech = posMatch?.[1]?.trim();
    const blockHeadword = headerWithoutPronunciation
      .replace(/\b(NOUN|VERB|ADJECTIVE|ADVERB|PRONOUN|PREPOSITION|CONJUNCTION|INTERJECTION|PHRASE)\b/i, "")
      .trim();
    if (!headword && blockHeadword) headword = blockHeadword;
    if (!pronunciation && blockPronunciation) pronunciation = blockPronunciation;

    let definitionLine = "";
    let chineseMeaning = "";
    let exampleLine = "";
    const filtered = block.slice(1).filter((line) => !line.includes("American English:"));
    for (let i = 0; i < filtered.length; i += 1) {
      const line = filtered[i];
      if (!definitionLine && line && !line.includes("Chinese:")) {
        definitionLine = line;
        continue;
      }
      if (!chineseMeaning && line.includes("Chinese:")) {
        chineseMeaning = line.replace(/^.*Chinese:\s*/, "").trim();
        continue;
      }
      if (!exampleLine && looksLikeExample(line)) {
        exampleLine = line;
      }
    }

    if (definitionLine || chineseMeaning) {
      senses.push({
        partOfSpeech,
        label: blockHeadword,
        meaning: chineseMeaning || definitionLine,
        englishDefinition: definitionLine || undefined,
      });
    }
    if (exampleLine) {
      examples.push({ english: exampleLine });
    }
  }

  return { headword, pronunciation, senses, examples };
}

function parseChineseBlocks(lines: string[]): { headword?: string; pronunciation?: string; senses: Sense[]; examples: Example[] } {
  const senses: Sense[] = [];
  const examples: Example[] = [];
  const titleIndex = lines.findIndex((line) => line.startsWith("## "));
  const headword = titleIndex >= 0 ? lines[titleIndex].replace(/^##\s*/, "").trim() : undefined;
  let pronunciation: string | undefined;
  const pronunciationIndex = titleIndex >= 0 ? titleIndex + 1 : lines.findIndex((line) => /^\[[^\]]+\]$/.test(line));
  if (pronunciationIndex >= 0 && /^\[[^\]]+\]$/.test(lines[pronunciationIndex])) {
    pronunciation = lines[pronunciationIndex].slice(1, -1);
  }

  const posMap: Record<string, string> = {
    名: "noun",
    动: "verb",
    形: "adjective",
    副: "adverb",
    介: "preposition",
    连: "conjunction",
    代: "pronoun",
    叹: "interjection",
    数: "numeral",
    量: "measure word",
    短语: "phrase",
  };

  const posIndex = titleIndex >= 0 ? titleIndex + 2 : -1;
  const partOfSpeechLine = posIndex >= 0 ? lines[posIndex] : undefined;
  const partOfSpeech = partOfSpeechLine && posMap[partOfSpeechLine] ? posMap[partOfSpeechLine] : undefined;

  for (let i = Math.max(posIndex + 1, 0); i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line === headword || line === pronunciation) continue;
    if (line.startsWith("## In other languages") || line.startsWith("Copyright")) break;
    if (line.startsWith("You may also like")) break;
    if (line === partOfSpeechLine) continue;
    if (line.startsWith("Chinese:") || line.startsWith("British English:")) continue;

    const bilingualMatch = line.match(/^(.*?)\s*\[[^\]]+\]\s*(.+)$/);
    if (bilingualMatch) {
      const label = bilingualMatch[1].trim();
      const meaning = bilingualMatch[2].trim();
      if (meaning) {
        senses.push({
          partOfSpeech,
          label,
          meaning,
          englishDefinition: meaning,
        });
      }
      continue;
    }

    if (/^[A-Za-z][A-Za-z\s-]*$/.test(line)) {
      senses.push({
        partOfSpeech,
        meaning: line,
        englishDefinition: line,
      });
    }
  }

  return { headword, pronunciation, senses, examples };
}

function parsePage(query: string, direction: "en-zh" | "zh-en", snapshot: PageSnapshot): LookupResult {
  const lines = compactLines(snapshot.text);
  const english = direction === "en-zh" ? parseEnglishBlocks(lines) : parseChineseBlocks(lines);
  const headword = english.headword || parseHeadwordFromTitle(snapshot.title) || query;
  const collocations = unique(extractSection(lines, "COBUILD Collocations", ["Examples of", "In other languages", "Related terms", "More idioms", "See also"])).filter(
    (line) => line.toLowerCase() !== headword.toLowerCase(),
  );
  const examples = unique(english.examples.map((item) => item.english))
    .slice(0, 5)
    .map((englishExample) => {
      const split = splitBilingualLine(englishExample);
      return split.chinese ? { english: split.english, chinese: split.chinese } : { english: split.english };
    });

  const found = english.senses.length > 0;
  return {
    query,
    normalizedQuery: normalizeLookupKey(query, direction),
    direction,
    headword,
    pronunciation: english.pronunciation,
    senses: english.senses.slice(0, 8),
    collocations: collocations.slice(0, 8),
    examples,
    sourceUrl: snapshot.url,
    source: "collins",
    found,
    message: found ? undefined : "Collins 中未找到对应词条",
    cachedAt: now(),
  };
}

class CollinsLookupClient {
  private window: BrowserWindow | null = null;

  private visibleWindow: BrowserWindow | null = null;

  private queue: Promise<unknown> = Promise.resolve();

  private ensureWindow() {
    if (this.window) return this.window;
    this.window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      backgroundColor: "#ffffff",
      webPreferences: {
        partition: collinsPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window.on("closed", () => {
      this.window = null;
    });
    return this.window;
  }

  private async loadSnapshot(url: string): Promise<PageSnapshot> {
    const window = this.ensureWindow();
    await withTimeout(window.loadURL(url, { userAgent: "Mozilla/5.0" }), 12000, "Collins 页面加载超时");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const snapshot = await window.webContents.executeJavaScript(`(() => ({
      title: document.title || "",
      text: document.body ? document.body.innerText || "" : "",
      html: document.body ? document.body.innerHTML || "" : "",
      url: location.href || ""
    }))()`);
    const pageSnapshot = snapshot as PageSnapshot;
    if (isChallengePage(pageSnapshot)) {
      throw new Error("Collins 正在要求浏览器验证，请先打开 Collins 初始化连接");
    }
    return pageSnapshot;
  }

  async openVisibleWindow(query?: string) {
    const normalized = normalizeWhitespace(query ?? "");
    const url = normalized
      ? hasCjk(normalized)
        ? `https://www.collinsdictionary.com/dictionary/chinese-english/${encodeURIComponent(normalized)}`
        : `https://www.collinsdictionary.com/dictionary/english/${slugifyEnglish(normalized)}`
      : collinsHomeUrl;
    if (this.visibleWindow && !this.visibleWindow.isDestroyed()) {
      await this.visibleWindow.loadURL(url, { userAgent: "Mozilla/5.0" });
      this.visibleWindow.show();
      this.visibleWindow.focus();
      return this.visibleWindow;
    }

    this.visibleWindow = new BrowserWindow({
      show: true,
      width: 1200,
      height: 900,
      backgroundColor: "#ffffff",
      webPreferences: {
        partition: collinsPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.visibleWindow.on("closed", () => {
      this.visibleWindow = null;
    });
    await this.visibleWindow.loadURL(url, { userAgent: "Mozilla/5.0" });
    return this.visibleWindow;
  }

  private async loadSearchResult(query: string): Promise<string | null> {
    const snapshot = await this.loadSnapshot(`https://www.collinsdictionary.com/search/?q=${encodeURIComponent(query)}`);
    const hrefs = await this.ensureWindow().webContents.executeJavaScript(`(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((anchor) => ({
          href: anchor.getAttribute('href') || '',
          text: (anchor.textContent || '').trim()
        }))
        .filter((item) => /\\/dictionary\\/(english|chinese-english)\\//.test(item.href) && item.text.length > 0);
    })()`);
    const first = (hrefs as Array<{ href: string; text: string }>).find((item) => item.href.includes("/dictionary/"));
    if (!first) return null;
    const href = first.href.startsWith("http") ? first.href : new URL(first.href, snapshot.url).toString();
    return href;
  }

  private async lookupInternal(query: string, direction: "en-zh" | "zh-en"): Promise<LookupResult> {
    const normalized = normalizeWhitespace(query);
    if (!normalized) {
      return baseNotFound(query, direction, "", "请输入要查询的词或短语");
    }
    const cacheKey = `${direction}:${normalizeLookupKey(normalized, direction)}`;
    const cached = await getLookupCache(cacheKey);
    if (cached) {
      return cached;
    }

    let targetUrl =
      direction === "zh-en"
        ? `https://www.collinsdictionary.com/dictionary/chinese-english/${encodeURIComponent(normalized)}`
        : `https://www.collinsdictionary.com/dictionary/english/${slugifyEnglish(normalized)}`;
    let result: LookupResult | null = null;
    let lastErrorMessage = "";

    try {
      const snapshot = await this.loadSnapshot(targetUrl);
      result = parsePage(normalized, direction, snapshot);
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Collins 查询失败";
    }

    if (!result || !result.found) {
      try {
        const resolved = await this.loadSearchResult(normalized);
        if (resolved) {
          targetUrl = resolved;
          const searchSnapshot = await this.loadSnapshot(resolved);
          result = parsePage(normalized, direction, searchSnapshot);
        }
      } catch (error) {
        if (!lastErrorMessage) {
          lastErrorMessage = error instanceof Error ? error.message : "Collins 查询失败";
        }
      }
    }

    if (!result || !result.found) {
      const fallback = result ?? baseNotFound(normalized, direction, targetUrl, "Collins 中未找到对应词条");
      const localResult = localFallback(normalized, direction, fallback.message || lastErrorMessage || "Collins 连接失败");
      if (localResult) {
        return localResult;
      }
      return {
        ...fallback,
        sourceUrl: targetUrl,
        message:
          fallback.message ||
          lastErrorMessage ||
          "Collins 中未找到对应词条。若是连接问题，请点击“打开 Collins 初始化连接”，完成验证后重试。",
      };
    }

    await setLookupCache(cacheKey, result);
    return result;
  }

  lookup(query: string, direction?: "en-zh" | "zh-en") {
    const actualDirection = direction ?? guessDirection(query);
    const task = () => this.lookupInternal(query, actualDirection);
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

export const collinsLookupClient = new CollinsLookupClient();

export async function lookupCollins(query: string, direction?: "en-zh" | "zh-en") {
  return collinsLookupClient.lookup(query, direction);
}

export async function openCollinsWindow(query?: string) {
  return collinsLookupClient.openVisibleWindow(query);
}
