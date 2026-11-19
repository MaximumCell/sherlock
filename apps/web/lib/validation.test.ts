import { describe, expect, it } from "vitest";
import { TARGET_TYPES, type TargetType } from "./types";
import { TARGET_TYPE_META, isIPv4, isIPv6, parseTags, validateTarget } from "./validation";

const ok = (type: TargetType, input: string) => {
  const result = validateTarget(type, input);
  if (!result.ok) throw new Error(`expected ${type} "${input}" to be valid: ${result.error}`);
  return result.value;
};
const bad = (type: TargetType, input: string) => expect(validateTarget(type, input).ok).toBe(false);

describe("validateTarget", () => {
  it("rejects empty and oversized input for every type", () => {
    for (const type of TARGET_TYPES) {
      bad(type, "   ");
      bad(type, "a".repeat(321));
    }
  });

  it("username: strips a leading @ and rejects spaces and emails", () => {
    expect(ok("username", " @ada-fixture ")).toBe("ada-fixture");
    expect(ok("username", "a")).toBe("a");
    bad("username", "ada fixture");
    bad("username", "ada@example.com");
    bad("username", "-ada");
    bad("username", "x".repeat(65));
  });

  it("email: lowercases and requires a dotted domain", () => {
    expect(ok("email", "Ada.Fixture@Example.COM")).toBe("ada.fixture@example.com");
    bad("email", "not-an-email");
    bad("email", "a@b");
    bad("email", "a b@example.com");
  });

  it("domain: strips scheme, path and port", () => {
    expect(ok("domain", "https://Fixture-Labs.example/path?x=1")).toBe("fixture-labs.example");
    expect(ok("domain", "example.com:8443")).toBe("example.com");
    bad("domain", "localhost");
    bad("domain", "192.0.2.1");
    bad("domain", "-bad.example");
  });

  it("ip: accepts IPv4 and IPv6 only", () => {
    expect(ok("ip", "192.0.2.44")).toBe("192.0.2.44");
    expect(ok("ip", "2001:DB8::44")).toBe("2001:db8::44");
    bad("ip", "256.1.1.1");
    bad("ip", "192.0.2");
    bad("ip", "01.2.3.4");
    bad("ip", "example.com");
  });

  it("image: requires an http(s) URL", () => {
    expect(ok("image", "https://example.com/a.png")).toBe("https://example.com/a.png");
    bad("image", "example.com/a.png");
    bad("image", "javascript:alert(1)");
    bad("image", "data:image/png;base64,AAAA");
  });

  it("phone: normalises to +digits and checks length", () => {
    expect(ok("phone", "+44 (20) 7946-0000")).toBe("+442079460000");
    expect(ok("phone", "2079460000")).toBe("+2079460000");
    bad("phone", "12345");
    bad("phone", "+1 555 CALL NOW");
    bad("phone", "1".repeat(16));
  });

  it("wallet: accepts bitcoin and EVM addresses", () => {
    expect(ok("wallet", "0x52908400098527886E0F7030069857D2E4169EE7")).toMatch(/^0x/);
    expect(ok("wallet", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toMatch(/^bc1/);
    expect(ok("wallet", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT")).toMatch(/^1/);
    bad("wallet", "0x1234");
    bad("wallet", "not-a-wallet");
  });

  it("name: collapses whitespace and rejects digits", () => {
    expect(ok("name", "  Ada   Fixture ")).toBe("Ada Fixture");
    expect(ok("name", "Zoë O’Neil-Åström")).toBe("Zoë O’Neil-Åström");
    bad("name", "Al");
    bad("name", "Ada 123");
  });

  it("only name requires sign-in", () => {
    expect(TARGET_TYPES.filter((t) => TARGET_TYPE_META[t].requiresSignIn)).toEqual(["name"]);
  });
});

describe("ip helpers", () => {
  it("validates addresses", () => {
    expect(isIPv4("0.0.0.0")).toBe(true);
    expect(isIPv4("1.2.3.4.5")).toBe(false);
    expect(isIPv6("::1")).toBe(true);
    expect(isIPv6("2001:db8:0:0:0:0:0:1")).toBe(true);
    expect(isIPv6("2001:db8::1::2")).toBe(false);
    expect(isIPv6("12345::1")).toBe(false);
  });
});

describe("parseTags", () => {
  it("splits, slugs, de-duplicates and caps", () => {
    expect(parseTags(" Client A, self-audit\nclient a ,, ")).toEqual(["client-a", "self-audit"]);
    expect(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(","))).toHaveLength(12);
    expect(parseTags("")).toEqual([]);
  });
});
