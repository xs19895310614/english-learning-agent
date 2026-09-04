import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupLocalDictionary: vi.fn(),
  lookupWithDeepSeek: vi.fn(),
  getLookupCache: vi.fn(),
  setLookupCache: vi.fn(),
}));

vi.mock("../electron/local-dictionary", () => ({
  lookupLocalDictionary: mocks.lookupLocalDictionary,
}));

vi.mock("../electron/deepseek", () => ({
  lookupWithDeepSeek: mocks.lookupWithDeepSeek,
}));

vi.mock("../electron/store", () => ({
  getLookupCache: mocks.getLookupCache,
  setLookupCache: mocks.setLookupCache,
}));

import { enrichDictionary, lookupDictionary } from "../electron/dictionary";

function result(source: "local-dictionary" | "ai") {
  return {
    query: "test",
    normalizedQuery: "test",
    direction: "en-zh" as const,
    headword: "test",
    senses: [{ meaning: "测试" }],
    collocations: [],
    examples: [],
    sourceUrl: "",
    source,
    found: true,
  };
}

describe("dictionary routing", () => {
  beforeEach(() => {
    mocks.lookupLocalDictionary.mockReset();
    mocks.lookupWithDeepSeek.mockReset();
    mocks.getLookupCache.mockReset().mockResolvedValue(null);
    mocks.setLookupCache.mockReset().mockResolvedValue(undefined);
  });

  it("returns a local hit without calling AI", async () => {
    mocks.lookupLocalDictionary.mockResolvedValue({
      ...result("local-dictionary"),
      examples: [{ english: "This is a test.", chinese: "这是一个测试。" }],
    });

    const response = await lookupDictionary({ query: "test" });

    expect(response.source).toBe("local-dictionary");
    expect(mocks.lookupWithDeepSeek).not.toHaveBeenCalled();
  });

  it("automatically enriches a local hit when examples are missing", async () => {
    const local = {
      ...result("local-dictionary"),
      query: "automatic enrichment word",
      normalizedQuery: "automatic enrichment word",
    };
    const supplement = {
      ...result("ai"),
      examples: [{ english: "This is a natural example.", chinese: "这是一个自然的例句。" }],
    };
    mocks.lookupLocalDictionary.mockResolvedValue(local);
    mocks.lookupWithDeepSeek.mockResolvedValue(supplement);

    const response = await lookupDictionary({ query: "automatic enrichment word" });

    expect(response.examples).toEqual(supplement.examples);
    expect(response.senses).toEqual(local.senses);
    expect(mocks.lookupWithDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("calls AI enrichment separately when a local result has no examples", async () => {
    const local = {
      ...result("local-dictionary"),
      examples: [],
    };
    const supplement = {
      ...result("ai"),
      examples: [{ english: "A useful example.", chinese: "一个有用的例句。" }],
    };
    mocks.lookupLocalDictionary.mockResolvedValue(local);
    mocks.lookupWithDeepSeek.mockResolvedValue(supplement);

    const response = await enrichDictionary({ query: "test", base: local });

    expect(response.examples).toEqual(supplement.examples);
    expect(mocks.lookupWithDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("uses AI only after a local miss", async () => {
    mocks.lookupLocalDictionary.mockResolvedValue(null);
    mocks.lookupWithDeepSeek.mockResolvedValue(result("ai"));

    const response = await lookupDictionary({ query: "rare phrase" });

    expect(response.source).toBe("ai");
    expect(mocks.lookupWithDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("routes Chinese input to AI", async () => {
    mocks.lookupWithDeepSeek.mockResolvedValue({
      ...result("ai"),
      query: "你好",
      direction: "zh-en",
    });

    const response = await lookupDictionary({ query: "你好" });

    expect(response.direction).toBe("zh-en");
    expect(mocks.lookupLocalDictionary).not.toHaveBeenCalled();
    expect(mocks.lookupWithDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("sends a complete English sentence directly to AI translation", async () => {
    mocks.lookupWithDeepSeek.mockResolvedValue({
      ...result("ai"),
      query: "I would like to book a table.",
      headword: undefined,
      senses: [],
      translation: "我想预订一张桌子。",
    });

    const response = await lookupDictionary({ query: "I would like to book a table." });

    expect(response.translation).toBe("我想预订一张桌子。");
    expect(mocks.lookupLocalDictionary).not.toHaveBeenCalled();
    expect(mocks.lookupWithDeepSeek).toHaveBeenCalledTimes(1);
  });

  it("merges a cached AI supplement into a local dictionary result", async () => {
    const local = {
      ...result("local-dictionary"),
      query: "cached supplement word",
      normalizedQuery: "cached supplement word",
    };
    const supplement = {
      ...result("ai"),
      query: "cached supplement word",
      normalizedQuery: "cached supplement word",
      examples: [{ english: "This is a natural example.", chinese: "这是一个自然的例句。" }],
      synonyms: ["sample"],
    };
    mocks.lookupLocalDictionary.mockResolvedValue(local);
    mocks.getLookupCache.mockImplementation(async (key: string) =>
      key.startsWith("dictionary-ai:") ? supplement : null,
    );

    const response = await lookupDictionary({ query: "cached supplement word" });

    expect(response.senses[0].meaning).toBe("测试");
    expect(response.examples).toEqual(supplement.examples);
    expect(response.synonyms).toEqual(["sample"]);
    expect(mocks.lookupWithDeepSeek).not.toHaveBeenCalled();
  });

  it("reuses cached enrichment without another AI request", async () => {
    const supplement = {
      ...result("ai"),
      query: "reuse enrichment phrase",
      normalizedQuery: "reuse enrichment phrase",
      examples: [{ english: "Reuse this result.", chinese: "复用这个结果。" }],
    };
    mocks.getLookupCache.mockImplementation(async (key: string) =>
      key.startsWith("dictionary-ai:") ? supplement : null,
    );

    const response = await enrichDictionary({
      query: "reuse enrichment phrase",
      base: {
        ...result("local-dictionary"),
        query: "reuse enrichment phrase",
        normalizedQuery: "reuse enrichment phrase",
      },
    });

    expect(response.examples).toEqual(supplement.examples);
    expect(mocks.lookupWithDeepSeek).not.toHaveBeenCalled();
  });
});
