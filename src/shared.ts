export type CorrectionMode = "light" | "detailed";
export type ConversationEnvironment = "casual" | "serious" | "work" | "academic" | "travel";

export type MessageRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  correction?: Correction | null;
  createdAt: string;
};

export type Correction = {
  original: string;
  recommended: string;
  reason: string;
  details?: string[];
  alternatives?: string[];
};

export type Example = {
  english: string;
  chinese?: string;
};

export type Sense = {
  partOfSpeech?: string;
  label?: string;
  meaning: string;
  englishDefinition?: string;
};

export type LookupResult = {
  query: string;
  normalizedQuery: string;
  direction: "en-zh" | "zh-en";
  headword?: string;
  pronunciation?: string;
  translation?: string;
  senses: Sense[];
  collocations: string[];
  examples: Example[];
  synonyms?: string[];
  sourceUrl: string;
  source: "collins" | "local-fallback" | "local-dictionary" | "ai";
  found: boolean;
  message?: string;
  cachedAt?: string;
  wordForms?: string[];
  alternatives?: string[];
  confidence?: number;
  providerLatencyMs?: number;
};

export type StudyItemType = "word" | "phrase" | "sentence";
export type StudyItemSource = "manual" | "conversation" | "collins" | "local-fallback" | "local-dictionary" | "ai";

export type StudyItem = {
  id: string;
  type: StudyItemType;
  english: string;
  chineseMeaning?: string;
  lookup?: LookupResult;
  source: StudyItemSource;
  tags: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  baseUrl: string;
  model: string;
  correctionMode: CorrectionMode;
  hasApiKey: boolean;
};

export type ChatResponse = {
  conversationId?: string;
  message: ConversationMessage;
  correction: Correction | null;
};

export type CreateStudyItemInput = {
  type: StudyItemType;
  english: string;
  chineseMeaning?: string;
  lookup?: LookupResult;
  source: StudyItemSource;
  tags?: string[];
  note?: string;
};

export type UpdateStudyItemInput = Partial<CreateStudyItemInput> & { id: string };

export type ElectronApi = {
  chat: {
    send: (input: {
      conversationId: string;
      content: string;
      correctionMode: CorrectionMode;
      environment: ConversationEnvironment;
    }) => Promise<ChatResponse>;
    history: (conversationId: string) => Promise<ConversationMessage[]>;
    conversation: () => Promise<Conversation>;
    list: () => Promise<Conversation[]>;
    delete: (conversationId: string) => Promise<void>;
  };
  dictionary: {
    lookup: (input: {
      query: string;
      direction?: "en-zh" | "zh-en";
      context?: string;
    }) => Promise<LookupResult>;
    enrich: (input: {
      query: string;
      direction?: "en-zh" | "zh-en";
      context?: string;
      base?: LookupResult;
    }) => Promise<LookupResult>;
    openCollins: (query?: string) => Promise<void>;
  };
  study: {
    list: () => Promise<StudyItem[]>;
    create: (input: CreateStudyItemInput) => Promise<StudyItem>;
    update: (input: UpdateStudyItemInput) => Promise<StudyItem>;
    delete: (id: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    save: (input: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      correctionMode?: CorrectionMode;
    }) => Promise<AppSettings>;
    testConnection: () => Promise<{ ok: boolean; message: string }>;
  };
};
