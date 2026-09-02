import { describe, expect, it } from "vitest";
import {
  compactLines,
  hasCjk,
  isLikelyEnglishSentence,
  normalizeLookupKey,
  slugifyEnglish,
} from "../electron/lookup-utils";

describe("lookup-utils", () => {
  it("detects CJK text", () => {
    expect(hasCjk("词典")).toBe(true);
    expect(hasCjk("dictionary")).toBe(false);
  });

  it("normalizes lookup keys", () => {
    expect(normalizeLookupKey("  Up To Date  ", "en-zh")).toBe("up to date");
    expect(normalizeLookupKey("词典", "zh-en")).toBe("词典");
  });

  it("slugifies English text", () => {
    expect(slugifyEnglish("Up to date")).toBe("up-to-date");
    expect(slugifyEnglish("don't")).toBe("dont");
  });

  it("compacts lines", () => {
    expect(compactLines("a\n\n b \n c")).toEqual(["a", "b", "c"]);
  });

  it("distinguishes complete sentences from long phrases", () => {
    expect(isLikelyEnglishSentence("I would like some coffee")).toBe(true);
    expect(isLikelyEnglishSentence("I agree")).toBe(true);
    expect(isLikelyEnglishSentence("a reality check every now and then")).toBe(false);
    expect(isLikelyEnglishSentence("The meeting starts at nine.")).toBe(true);
  });
});
