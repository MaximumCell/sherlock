import type { TargetType } from "./types";

export type ValidationResult = { ok: true; value: string } | { ok: false; error: string };

export interface TargetTypeMeta {
  type: TargetType;
  label: string;
  placeholder: string;
  hint: string;
  requiresSignIn: boolean;
}

export const TARGET_TYPE_META: Record<TargetType, TargetTypeMeta> = {
  username: {
    type: "username",
    label: "Username",
    placeholder: "ada-fixture",
    hint: "A handle, without the @.",
    requiresSignIn: false,
  },
  email: {
    type: "email",
    label: "Email",
    placeholder: "ada@example.com",
    hint: "Checks account registrations and breach exposure metadata.",
    requiresSignIn: false,
  },
  domain: {
    type: "domain",
    label: "Domain",
    placeholder: "example.com",
    hint: "DNS, certificates and hosting records.",
    requiresSignIn: false,
  },
  ip: {
    type: "ip",
    label: "IP address",
    placeholder: "192.0.2.10",
    hint: "IPv4 or IPv6.",
    requiresSignIn: false,
  },
  image: {
    type: "image",
    label: "Image URL",
    placeholder: "https://example.com/avatar.png",
    hint: "Perceptual hash and metadata. No face recognition.",
    requiresSignIn: false,
  },
  phone: {
    type: "phone",
    label: "Phone",
    placeholder: "+44 20 7946 0000",
    hint: "International format. Number metadata only, never an identity lookup.",
    requiresSignIn: false,
  },
  wallet: {
    type: "wallet",
    label: "Wallet",
    placeholder: "0x52908400098527886E0F7030069857D2E4169EE7",
    hint: "Bitcoin or EVM address.",
    requiresSignIn: false,
  },
  name: {
    type: "name",
    label: "Name",
    placeholder: "Ada Fixture",
    hint: "Full name search is rate-limited and requires a signed-in account.",
    requiresSignIn: true,
  },
};

const fail = (error: string): ValidationResult => ({ ok: false, error });
const pass = (value: string): ValidationResult => ({ ok: true, value });

const EMAIL_RE = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9_])?$/i;
const BTC_RE = /^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M}'’. -]*$/u;

export function isIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && String(Number(p)) === p);
}

export function isIPv6(value: string): boolean {
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(":")) return false;
  const doubles = value.split("::");
  if (doubles.length > 2) return false;
  const groups = value.split(":").filter((g) => g.length > 0);
  if (groups.some((g) => g.length > 4)) return false;
  return doubles.length === 2 ? groups.length <= 7 : groups.length === 8;
}

/** Validate and normalise one target value. Returned `value` is what gets sent to the gateway. */
export function validateTarget(type: TargetType, input: string): ValidationResult {
  const raw = input.trim();
  if (!raw) return fail("Enter a value.");
  if (raw.length > 320) return fail("Too long (320 characters maximum).");

  switch (type) {
    case "username": {
      const v = raw.replace(/^@/, "");
      if (/\s/.test(v)) return fail("Usernames cannot contain spaces.");
      if (v.includes("@")) return fail("That looks like an email. Switch the type to Email.");
      if (!USERNAME_RE.test(v)) {
        return fail("Use letters, digits, dots, dashes or underscores (max 64).");
      }
      return pass(v);
    }
    case "email": {
      const v = raw.toLowerCase();
      if (!EMAIL_RE.test(v)) return fail("Enter a valid email address.");
      return pass(v);
    }
    case "domain": {
      const v = raw
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/[/?#].*$/, "")
        .replace(/:\d+$/, "")
        .replace(/\.$/, "");
      if (isIPv4(v)) return fail("That is an IP address. Switch the type to IP address.");
      if (!DOMAIN_RE.test(v)) return fail("Enter a domain such as example.com.");
      return pass(v);
    }
    case "ip": {
      const v = raw.toLowerCase();
      if (!isIPv4(v) && !isIPv6(v)) return fail("Enter a valid IPv4 or IPv6 address.");
      return pass(v);
    }
    case "image": {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return fail("Enter a full image URL starting with https://.");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return fail("Only http(s) image URLs are supported.");
      }
      return pass(url.toString());
    }
    case "phone": {
      const digits = raw.replace(/[\s().-]/g, "");
      if (!/^\+?\d+$/.test(digits)) return fail("Use digits only, with an optional leading +.");
      const bare = digits.replace(/^\+/, "");
      if (bare.length < 7 || bare.length > 15) {
        return fail("Enter 7 to 15 digits in international format.");
      }
      return pass(`+${bare}`);
    }
    case "wallet": {
      if (!BTC_RE.test(raw) && !EVM_RE.test(raw)) {
        return fail("Enter a Bitcoin or EVM (0x…) address.");
      }
      return pass(raw);
    }
    case "name": {
      const v = raw.replace(/\s+/g, " ");
      if (v.length < 3) return fail("Enter at least 3 characters.");
      if (v.length > 120) return fail("Too long (120 characters maximum).");
      if (!NAME_RE.test(v)) return fail("Names can contain letters, spaces, hyphens and apostrophes.");
      return pass(v);
    }
  }
}

/** Parse a free-text tag input ("a, b  c") into a clean, de-duplicated list. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[,\n]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 12);
}
