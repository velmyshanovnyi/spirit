import { describe, it, expect } from "vitest";
import { generateAnonymousNickname } from "../js/anonymousNickname.js";

describe("generateAnonymousNickname", () => {
  it("returns a two-word string (adjective + creature)", () => {
    const nickname = generateAnonymousNickname();
    expect(typeof nickname).toBe("string");
    expect(nickname.split(" ").length).toBe(2);
  });

  it("produces varied results across many calls (not always the same one)", () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      results.add(generateAnonymousNickname());
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
