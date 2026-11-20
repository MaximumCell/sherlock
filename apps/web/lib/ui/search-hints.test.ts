import { describe, expect, it } from "vitest";
import { chipState, exampleDuration, TYPEWRITER, typewriterText } from "./search-hints";

describe("chipState", () => {
  it("shows nothing for an empty box", () => {
    expect(chipState("  ", null, null)).toMatchObject({ kind: "empty", action: null });
  });

  it("says what the guess is", () => {
    const chip = chipState("ada@example.com", null, "email");
    expect(chip).toMatchObject({ kind: "detected", type: "email", action: "change" });
    expect(chip.phrase).toBe("Looks like an email address");
  });

  it("admits when it cannot tell", () => {
    expect(chipState("???", null, null)).toMatchObject({
      kind: "unsure",
      type: null,
      phrase: "Not sure what this is",
      action: "choose",
    });
  });

  it("lets a hand-picked type win, even on an empty box", () => {
    expect(chipState("ada", "domain", "username").phrase).toBe("Searching as a website");
    expect(chipState("", "name", null).kind).toBe("chosen");
  });
});

describe("typewriterText", () => {
  const ex = ["abc", "de"];

  it("types, holds, erases, then moves on", () => {
    expect(typewriterText(ex, 0).text).toBe("");
    expect(typewriterText(ex, TYPEWRITER.type * 2 + 1).text).toBe("ab");
    expect(typewriterText(ex, TYPEWRITER.type * 3 + 10).text).toBe("abc");
    const erasing = TYPEWRITER.type * 3 + TYPEWRITER.hold + TYPEWRITER.erase + 1;
    expect(typewriterText(ex, erasing).text).toBe("ab");
    const second = exampleDuration("abc") + TYPEWRITER.type + 1;
    expect(typewriterText(ex, second)).toEqual({ text: "d", index: 1 });
  });

  it("cycles forever and copes with no examples", () => {
    const cycle = exampleDuration("abc") + exampleDuration("de");
    expect(typewriterText(ex, cycle + TYPEWRITER.type * 2 + 1).text).toBe("ab");
    expect(typewriterText([], 1234).text).toBe("");
  });
});
