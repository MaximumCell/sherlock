import { describe, expect, it } from "vitest";
import { detectTarget } from "./detect-target";
import type { TargetType } from "./types";

const CASES: [input: string, expected: TargetType | null][] = [
  // usernames
  ["ada-fixture", "username"],
  ["@ada-fixture", "username"],
  ["ada_fixture99", "username"],
  ["ada.fixture", "username"],
  ["a", "username"],
  ["Ada", "username"],
  // emails
  ["ada@example.com", "email"],
  ["Ada.Fixture+news@Example.COM", "email"],
  ["  ada@fixture-labs.example  ", "email"],
  // domains and site URLs
  ["example.com", "domain"],
  ["ada-fixture.example", "domain"],
  ["status.example.org", "domain"],
  ["sub.domain.co.uk", "domain"],
  ["https://example.com", "domain"],
  ["https://example.com/about?x=1", "domain"],
  ["example.com/path", "domain"],
  // IPs (RFC 5737 / RFC 3849)
  ["192.0.2.10", "ip"],
  ["198.51.100.7", "ip"],
  ["2001:db8::1", "ip"],
  ["2001:DB8:0:0:0:0:0:1", "ip"],
  // images
  ["https://example.com/avatar.png", "image"],
  ["http://example.com/a/b/photo.JPEG", "image"],
  ["https://cdn.example.org/me.webp", "image"],
  // phones
  ["+44 20 7946 0000", "phone"],
  ["+1 (555) 010-0199", "phone"],
  ["020 7946 0000", "phone"],
  ["+447946000000", "phone"],
  ["5550100199", "phone"],
  // wallets
  ["0x52908400098527886E0F7030069857D2E4169EE7", "wallet"],
  ["1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "wallet"],
  ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "wallet"],
  // names
  ["Marlow Quince", "name"],
  ["Ada Fixture", "name"],
  ["Anne-Marie O'Neil", "name"],
  ["Zoë  Éclair", "name"],
  // nothing sensible
  ["", null],
  ["   ", null],
  ["hello world 42", null],
  ["!!!", null],
  ["ada fixture@", null],
];

describe("detectTarget", () => {
  it.each(CASES)("%j → %s", (input, expected) => {
    expect(detectTarget(input)?.type ?? null).toBe(expected);
  });

  it("short digit runs are not phone numbers", () => {
    expect(detectTarget("12345")?.type).toBe("username");
    expect(detectTarget("1234567")?.type).toBe("username");
  });

  it("an IPv4 address is never read as a domain", () => {
    expect(detectTarget("203.0.113.5")?.type).toBe("ip");
  });

  it("gives a readable label for the chip", () => {
    expect(detectTarget("ada@example.com")?.label).toBe("an email address");
    expect(detectTarget("Marlow Quince")?.label).toBe("a person's name");
  });
});
