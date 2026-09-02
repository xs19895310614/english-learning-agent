import { describe, expect, it } from "vitest";
import { extractRelatedPhrases } from "../src/phrase-utils";

describe("phrase-utils", () => {
  it("extracts related phrases around a hovered word", () => {
    const phrases = extractRelatedPhrases("I gave up on the plan and gave it a try.", "gave");

    expect(phrases).toContain("gave up");
    expect(phrases).toContain("gave up on");
  });

  it("ignores unrelated text", () => {
    expect(extractRelatedPhrases("Short sentence.", "planet")).toEqual([]);
  });
});
