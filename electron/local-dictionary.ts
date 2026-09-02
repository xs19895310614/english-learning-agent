import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import initSqlJs, { Database } from "sql.js";
import type { Example, LookupResult, Sense } from "../src/shared";
import {
  compactLines,
  normalizeLookupKey,
  normalizeWhitespace,
  stripLookupKey,
  unique,
} from "./lookup-utils";

export type EcdictRow = {
  word: string;
  word_key: string;
  strip_key: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  collins: string;
  oxford: string;
  tag: string;
  bnc: string;
  frq: string;
  exchange: string;
  detail: string;
  audio: string;
};

type SqlModule = Awaited<ReturnType<typeof initSqlJs>>;

const dictionarySourceUrl =
  "https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";

const partOfSpeechMap: Record<string, string> = {
  a: "形容词",
  adj: "形容词",
  adv: "副词",
  art: "冠词",
  aux: "助动词",
  conj: "连词",
  interj: "感叹词",
  modal: "情态动词",
  n: "名词",
  num: "数词",
  prep: "介词",
  pron: "代词",
  s: "名词",
  v: "动词",
  vi: "不及物动词",
  vt: "及物动词",
  phr: "短语",
  phrase: "短语",
};

let sqlModulePromise: Promise<SqlModule> | null = null;
let dictionaryPromise: Promise<Database> | null = null;

function now() {
  return new Date().toISOString();
}

function dictionaryPath() {
  return path.join(app.getAppPath(), "resources", "dictionary", "ecdict.sqlite");
}

async function loadSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
    });
  }
  return sqlModulePromise;
}

async function getDictionaryDatabase() {
  if (!dictionaryPromise) {
    dictionaryPromise = (async () => {
      const sqlModule = await loadSqlModule();
      const file = await fs.readFile(dictionaryPath());
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      return new sqlModule.Database(new Uint8Array(buffer));
    })();
  }
  return dictionaryPromise;
}

export async function warmLocalDictionary() {
  await getDictionaryDatabase();
}

function readRows(db: Database, sql: string, params: string[]) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = values[index] == null ? "" : String(values[index]);
    });
    return row as unknown as EcdictRow;
  });
}

function parsePartOfSpeech(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  return partOfSpeechMap[normalized] || normalized || undefined;
}

function parseLine(line: string, fallbackPartOfSpeech?: string) {
  const match = line.match(/^(n|v|vt|vi|adj|a|adv|prep|conj|pron|num|art|aux|modal|interj|phr|phrase)\.\s*(.*)$/i);
  if (match) {
    return {
      partOfSpeech: parsePartOfSpeech(match[1]),
      text: match[2].trim(),
    };
  }
  return {
    partOfSpeech: fallbackPartOfSpeech,
    text: line.trim(),
  };
}

function fallbackPos(value: string) {
  const positions = value
    .split("/")
    .map((item) => item.split(":")[0]?.trim())
    .filter(Boolean)
    .map((item) => parsePartOfSpeech(item))
    .filter(Boolean);
  return positions.length ? unique(positions).join(" / ") : undefined;
}

export function parseEcdictSenses(row: Pick<EcdictRow, "translation" | "definition" | "pos">): Sense[] {
  const translations = compactLines(row.translation);
  const definitions = compactLines(row.definition);
  const defaultPartOfSpeech = fallbackPos(row.pos);
  const sourceLines = translations.length ? translations : definitions;

  const senses: Sense[] = [];
  sourceLines.forEach((line, index) => {
    const parsed = parseLine(line, defaultPartOfSpeech);
    const englishDefinition = translations.length ? definitions[index] : undefined;
    if (!parsed.text) return;
    senses.push({
      partOfSpeech: parsed.partOfSpeech,
      meaning: parsed.text,
      englishDefinition: englishDefinition?.trim() || undefined,
    });
  });
  return senses;
}

function collectExampleStrings(value: unknown, key = ""): Example[] {
  if (typeof value === "string") {
    const text = normalizeWhitespace(value);
    if (text && /[A-Za-z]/.test(text) && (/[.!?]$/.test(text) || key.includes("example") || key.includes("sentence"))) {
      return [{ english: text }];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectExampleStrings(item, key));
  }
  if (!value || typeof value !== "object") return [];

  const object = value as Record<string, unknown>;
  const english = typeof object.english === "string" ? normalizeWhitespace(object.english) : "";
  const chinese = typeof object.chinese === "string" ? normalizeWhitespace(object.chinese) : undefined;
  if (english) {
    return [{ english, chinese }];
  }
  return Object.entries(object).flatMap(([childKey, childValue]) =>
    collectExampleStrings(childValue, childKey.toLowerCase()),
  );
}

function parseExamples(detail: string) {
  if (!detail.trim()) return [];
  try {
    const parsed = JSON.parse(detail) as unknown;
    return unique(
      collectExampleStrings(parsed)
        .map((example) => JSON.stringify(example))
        .filter(Boolean),
    )
      .slice(0, 5)
      .map((item) => JSON.parse(item) as Example);
  } catch {
    return [];
  }
}

function parseWordForms(exchange: string, headword: string) {
  const forms = exchange
    .split("/")
    .map((part) => part.split(":")[1]?.trim() || "")
    .filter(Boolean);
  return unique([headword, ...forms]);
}

function rankRows(rows: EcdictRow[]) {
  return [...rows].sort((left, right) => {
    const collins = Number(right.collins || 0) - Number(left.collins || 0);
    if (collins !== 0) return collins;
    return Number(left.frq || Number.MAX_SAFE_INTEGER) - Number(right.frq || Number.MAX_SAFE_INTEGER);
  });
}

export function buildLocalLookupResult(
  query: string,
  direction: "en-zh" | "zh-en",
  rows: EcdictRow[],
  providerLatencyMs: number,
): LookupResult | null {
  if (!rows.length) return null;
  const ranked = rankRows(rows);
  const headword = ranked[0].word;
  const senses = unique(
    ranked
      .flatMap((row) => parseEcdictSenses(row))
      .map((sense) => JSON.stringify(sense)),
  )
    .slice(0, 16)
    .map((item) => JSON.parse(item) as Sense);
  const examples = unique(
    ranked
      .flatMap((row) => parseExamples(row.detail))
      .map((example) => JSON.stringify(example)),
  )
    .slice(0, 5)
    .map((item) => JSON.parse(item) as Example);
  const wordForms = unique(ranked.flatMap((row) => parseWordForms(row.exchange, row.word)));

  return {
    query,
    normalizedQuery: normalizeLookupKey(query, direction),
    direction,
    headword,
    pronunciation: ranked.find((row) => row.phonetic)?.phonetic || undefined,
    senses,
    collocations: [],
    examples,
    sourceUrl: dictionarySourceUrl,
    source: "local-dictionary",
    found: senses.length > 0,
    wordForms,
    cachedAt: now(),
    providerLatencyMs,
  };
}

export async function lookupLocalDictionary(
  query: string,
  direction: "en-zh" | "zh-en",
): Promise<LookupResult | null> {
  if (direction !== "en-zh") return null;
  const normalized = normalizeWhitespace(query);
  if (!normalized) return null;

  const startedAt = Date.now();
  const db = await getDictionaryDatabase();
  const wordKey = normalizeLookupKey(normalized, "en-zh");
  const stripKey = stripLookupKey(normalized);
  let rows = readRows(
    db,
    `
      SELECT word, word_key, strip_key, phonetic, definition, translation, pos,
             collins, oxford, tag, bnc, frq, exchange, detail, audio
      FROM entries
      WHERE word_key = ?
      ORDER BY CAST(collins AS INTEGER) DESC,
               CASE WHEN frq = '' THEN 2147483647 ELSE CAST(frq AS INTEGER) END ASC
      LIMIT 12
    `,
    [wordKey],
  );

  if (!rows.length && stripKey) {
    rows = readRows(
      db,
      `
        SELECT e.word, e.word_key, e.strip_key, e.phonetic, e.definition, e.translation, e.pos,
               e.collins, e.oxford, e.tag, e.bnc, e.frq, e.exchange, e.detail, e.audio
        FROM word_forms f
        JOIN entries e ON e.id = f.entry_id
        WHERE f.form_key IN (?, ?)
        ORDER BY CAST(e.collins AS INTEGER) DESC,
                 CASE WHEN e.frq = '' THEN 2147483647 ELSE CAST(e.frq AS INTEGER) END ASC
        LIMIT 12
      `,
      [wordKey, stripKey],
    );
  }

  if (!rows.length && stripKey) {
    rows = readRows(
      db,
      `
        SELECT word, word_key, strip_key, phonetic, definition, translation, pos,
               collins, oxford, tag, bnc, frq, exchange, detail, audio
        FROM entries
        WHERE strip_key = ?
        ORDER BY CAST(collins AS INTEGER) DESC,
                 CASE WHEN frq = '' THEN 2147483647 ELSE CAST(frq AS INTEGER) END ASC
        LIMIT 12
      `,
      [stripKey],
    );
  }

  return buildLocalLookupResult(normalized, direction, rows, Date.now() - startedAt);
}
