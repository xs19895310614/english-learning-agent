import { describe, expect, it } from "vitest";
import { buildLocalLookupResult, parseEcdictSenses, type EcdictRow } from "../electron/local-dictionary";

function row(overrides: Partial<EcdictRow> = {}): EcdictRow {
  return {
    word: "practice",
    word_key: "practice",
    strip_key: "practice",
    phonetic: "ˈpræktɪs",
    definition: "n. repeated activity done to improve a skill\nv. to do an activity repeatedly",
    translation: "n. 练习；实践\nv. 练习；训练",
    pos: "n:50/v:50",
    collins: "4",
    oxford: "1",
    tag: "cet4",
    bnc: "1000",
    frq: "1200",
    exchange: "i:practicing/p:practiced/3:practices",
    detail: "",
    audio: "",
    ...overrides,
  };
}

describe("local dictionary parsing", () => {
  it("parses multiple parts of speech and meanings", () => {
    const senses = parseEcdictSenses(row());
    expect(senses).toHaveLength(2);
    expect(senses[0]).toMatchObject({ partOfSpeech: "名词", meaning: "练习；实践" });
    expect(senses[1]).toMatchObject({ partOfSpeech: "动词", meaning: "练习；训练" });
  });

  it("builds a study-ready result with word forms", () => {
    const result = buildLocalLookupResult("practiced", "en-zh", [row()], 12);
    expect(result).toMatchObject({
      source: "local-dictionary",
      found: true,
      headword: "practice",
      providerLatencyMs: 12,
    });
    expect(result.wordForms).toEqual(["practice", "practicing", "practiced", "practices"]);
  });

  it("merges duplicate senses from multiple rows", () => {
    const result = buildLocalLookupResult("practice", "en-zh", [
      row(),
      row({ word: "practice (law)", word_key: "practice (law)", strip_key: "practicelaw" }),
    ], 5);
    expect(result?.senses.length).toBeGreaterThan(0);
    expect(new Set(result?.senses.map((sense) => `${sense.partOfSpeech}:${sense.meaning}`)).size).toBe(
      result?.senses.length,
    );
  });
});
