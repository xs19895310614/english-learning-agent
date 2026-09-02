import path from "node:path";
import fs from "node:fs/promises";
import { app, safeStorage } from "electron";
import initSqlJs, { Database } from "sql.js";
import type {
  AppSettings,
  ChatResponse,
  Conversation,
  ConversationMessage,
  Correction,
  CreateStudyItemInput,
  LookupResult,
  StudyItem,
  UpdateStudyItemInput,
} from "../src/shared";

type SqlModule = Awaited<ReturnType<typeof initSqlJs>>;

let sqlModulePromise: Promise<SqlModule> | null = null;
let dbPromise: Promise<Database> | null = null;
let databaseFilePath: string | null = null;

const defaultSettings: AppSettings = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  correctionMode: "light",
  hasApiKey: false,
};

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function readJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function encryptSecret(value: string) {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value;
}

function decryptSecret(value: string) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

async function ensureDataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
    });
  }
  return sqlModulePromise;
}

async function initDatabaseSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      correction TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(conversationId) REFERENCES conversations(id)
    );
    CREATE TABLE IF NOT EXISTS study_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      english TEXT NOT NULL,
      chineseMeaning TEXT,
      lookup TEXT,
      source TEXT NOT NULL,
      tags TEXT NOT NULL,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lookup_cache (
      cacheKey TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      cachedAt TEXT NOT NULL
    );
  `);

  const settingsCount = db.exec(`SELECT COUNT(*) AS count FROM settings WHERE key = 'app'`);
  if (settingsCount.length === 0 || settingsCount[0].values[0][0] === 0) {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
      "app",
      JSON.stringify(defaultSettings),
    ]);
  }
}

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const sqlModule = await loadSqlModule();
      const dataDir = await ensureDataDir();
      databaseFilePath = path.join(dataDir, "english-learning.sqlite");
      const db = new sqlModule.Database();
      try {
        const file = await fs.readFile(databaseFilePath);
        const arr = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        const loaded = new sqlModule.Database(new Uint8Array(arr));
        await initDatabaseSchema(loaded);
        return loaded;
      } catch {
        await initDatabaseSchema(db);
        return db;
      }
    })();
  }
  return dbPromise;
}

async function persistDatabase(db: Database) {
  if (!databaseFilePath) {
    const dataDir = await ensureDataDir();
    databaseFilePath = path.join(dataDir, "english-learning.sqlite");
  }
  const data = db.export();
  await fs.writeFile(databaseFilePath!, Buffer.from(data));
}

export async function withDatabase<T>(
  handler: (db: Database) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const db = await getDatabase();
  const result = await handler(db);
  if (persist) {
    await persistDatabase(db);
  }
  return result;
}

export async function getAppSettings(): Promise<AppSettings> {
  return withDatabase((db) => {
    const result = db.exec(`SELECT value FROM settings WHERE key = ?`, ["app"]);
    if (!result.length) {
      return { ...defaultSettings };
    }
    return readJson<AppSettings>(String(result[0].values[0][0]), defaultSettings);
  });
}

export async function saveAppSettings(
  input: Partial<Pick<AppSettings, "baseUrl" | "model" | "correctionMode">> & { hasApiKey?: boolean },
  apiKey?: string,
): Promise<AppSettings> {
  const next = await withDatabase(async (db) => {
    const currentResult = db.exec(`SELECT value FROM settings WHERE key = ?`, ["app"]);
    const current = currentResult.length
      ? readJson<AppSettings>(String(currentResult[0].values[0][0]), defaultSettings)
      : { ...defaultSettings };
    const merged: AppSettings = {
      ...current,
      ...input,
      hasApiKey: typeof input.hasApiKey === "boolean" ? input.hasApiKey : current.hasApiKey,
    };
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
      "app",
      JSON.stringify(merged),
    ]);
    if (apiKey !== undefined) {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        "deepseek_api_key",
        encryptSecret(apiKey),
      ]);
      merged.hasApiKey = apiKey.length > 0;
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        "app",
        JSON.stringify(merged),
      ]);
    }
    return merged;
  }, true);
  return next;
}

export async function getApiKey(): Promise<string | null> {
  return withDatabase((db) => {
    const result = db.exec(`SELECT value FROM settings WHERE key = ?`, ["deepseek_api_key"]);
    if (!result.length) {
      return null;
    }
    return decryptSecret(String(result[0].values[0][0]));
  });
}

export async function createConversation(title = "新对话"): Promise<Conversation> {
  return withDatabase((db) => {
    const conversation: Conversation = {
      id: id("conv"),
      title,
      createdAt: now(),
      updatedAt: now(),
    };
    db.run(
      `INSERT INTO conversations (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
      [conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt],
    );
    return conversation;
  }, true);
}

export async function listConversations(): Promise<Conversation[]> {
  return withDatabase((db) => {
    const result = db.exec(
      `SELECT id, title, createdAt, updatedAt FROM conversations ORDER BY updatedAt DESC`,
    );
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: String(row[0]),
      title: String(row[1]),
      createdAt: String(row[2]),
      updatedAt: String(row[3]),
    }));
  });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await withDatabase((db) => {
    db.run(`DELETE FROM messages WHERE conversationId = ?`, [conversationId]);
    db.run(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
  }, true);
}

export async function appendChatMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  correction?: Correction | null,
): Promise<ConversationMessage> {
  return withDatabase((db) => {
    const message: ConversationMessage = {
      id: id("msg"),
      conversationId,
      role,
      content,
      correction: correction ?? null,
      createdAt: now(),
    };
    db.run(
      `INSERT INTO messages (id, conversationId, role, content, correction, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.correction ? JSON.stringify(message.correction) : null,
        message.createdAt,
      ],
    );
    if (role === "user") {
      const titleResult = db.exec(`SELECT title FROM conversations WHERE id = ?`, [conversationId]);
      const currentTitle = titleResult.length ? String(titleResult[0].values[0][0]) : "";
      if (currentTitle === "新对话") {
        const title = content.replace(/\s+/g, " ").trim().slice(0, 32) || "新对话";
        db.run(`UPDATE conversations SET title = ? WHERE id = ?`, [title, conversationId]);
      }
    }
    db.run(`UPDATE conversations SET updatedAt = ? WHERE id = ?`, [message.createdAt, conversationId]);
    return message;
  }, true);
}

export async function getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  return withDatabase((db) => {
    const result = db.exec(
      `SELECT id, conversationId, role, content, correction, createdAt FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`,
      [conversationId],
    );
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: String(row[0]),
      conversationId: String(row[1]),
      role: String(row[2]) as "user" | "assistant" | "system",
      content: String(row[3]),
      correction: row[4] ? (JSON.parse(String(row[4])) as Correction) : null,
      createdAt: String(row[5]),
    }));
  });
}

export async function listStudyItems(): Promise<StudyItem[]> {
  return withDatabase((db) => {
    const result = db.exec(
      `SELECT id, type, english, chineseMeaning, lookup, source, tags, note, createdAt, updatedAt FROM study_items ORDER BY updatedAt DESC`,
    );
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: String(row[0]),
      type: String(row[1]) as StudyItem["type"],
      english: String(row[2]),
      chineseMeaning: row[3] ? String(row[3]) : undefined,
      lookup: row[4] ? (JSON.parse(String(row[4])) as LookupResult) : undefined,
      source: String(row[5]) as StudyItem["source"],
      tags: readJson<string[]>(String(row[6]), []),
      note: row[7] ? String(row[7]) : undefined,
      createdAt: String(row[8]),
      updatedAt: String(row[9]),
    }));
  });
}

export async function createStudyItem(input: CreateStudyItemInput): Promise<StudyItem> {
  return withDatabase((db) => {
    const createdAt = now();
    const item: StudyItem = {
      id: id("study"),
      type: input.type,
      english: input.english,
      chineseMeaning: input.chineseMeaning,
      lookup: input.lookup,
      source: input.source,
      tags: input.tags ?? [],
      note: input.note,
      createdAt,
      updatedAt: createdAt,
    };
    db.run(
      `INSERT INTO study_items (id, type, english, chineseMeaning, lookup, source, tags, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.type,
        item.english,
        item.chineseMeaning ?? null,
        item.lookup ? JSON.stringify(item.lookup) : null,
        item.source,
        JSON.stringify(item.tags),
        item.note ?? null,
        item.createdAt,
        item.updatedAt,
      ],
    );
    return item;
  }, true);
}

export async function updateStudyItem(input: UpdateStudyItemInput): Promise<StudyItem> {
  return withDatabase((db) => {
    const currentResult = db.exec(`SELECT * FROM study_items WHERE id = ?`, [input.id]);
    if (!currentResult.length) {
      throw new Error("未找到词条");
    }
    const row = currentResult[0].values[0];
    const item: StudyItem = {
      id: String(row[0]),
      type: (input.type ?? String(row[1])) as StudyItem["type"],
      english: input.english ?? String(row[2]),
      chineseMeaning: input.chineseMeaning ?? (row[3] ? String(row[3]) : undefined),
      lookup: input.lookup ?? (row[4] ? (JSON.parse(String(row[4])) as LookupResult) : undefined),
      source: (input.source ?? String(row[5])) as StudyItem["source"],
      tags: input.tags ?? readJson<string[]>(String(row[6]), []),
      note: input.note ?? (row[7] ? String(row[7]) : undefined),
      createdAt: String(row[8]),
      updatedAt: now(),
    };
    db.run(
      `UPDATE study_items SET type = ?, english = ?, chineseMeaning = ?, lookup = ?, source = ?, tags = ?, note = ?, updatedAt = ? WHERE id = ?`,
      [
        item.type,
        item.english,
        item.chineseMeaning ?? null,
        item.lookup ? JSON.stringify(item.lookup) : null,
        item.source,
        JSON.stringify(item.tags),
        item.note ?? null,
        item.updatedAt,
        item.id,
      ],
    );
    return item;
  }, true);
}

export async function deleteStudyItem(id: string): Promise<void> {
  await withDatabase((db) => {
    db.run(`DELETE FROM study_items WHERE id = ?`, [id]);
  }, true);
}

export async function setHasApiKey(hasApiKey: boolean) {
  return saveAppSettings({ hasApiKey });
}

export async function getLookupCache(cacheKey: string): Promise<LookupResult | null> {
  return withDatabase((db) => {
    const result = db.exec(`SELECT value FROM lookup_cache WHERE cacheKey = ?`, [cacheKey]);
    if (!result.length) return null;
    return JSON.parse(String(result[0].values[0][0])) as LookupResult;
  });
}

export async function setLookupCache(cacheKey: string, value: LookupResult) {
  return withDatabase((db) => {
    db.run(`INSERT OR REPLACE INTO lookup_cache (cacheKey, value, cachedAt) VALUES (?, ?, ?)`, [
      cacheKey,
      JSON.stringify(value),
      now(),
    ]);
  }, true);
}

export async function recordConversationTurn(
  conversationId: string,
  userContent: string,
  assistantContent: string,
  correction: Correction | null,
): Promise<ChatResponse> {
  const userMessage = await appendChatMessage(conversationId, "user", userContent, null);
  const assistantMessage = await appendChatMessage(
    conversationId,
    "assistant",
    assistantContent,
    correction,
  );
  return {
    message: assistantMessage,
    correction,
  };
}
