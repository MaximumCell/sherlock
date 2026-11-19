import type { TargetType } from "./types";
import { isIPv4, isIPv6 } from "./validation";

export interface Detection {
  type: TargetType;
  /** Plain-English label for the chip, e.g. "an email address". */
  label: string;
}

export const DETECTION_LABEL: Record<TargetType, string> = {
  username: "a username",
  email: "an email address",
  domain: "a website",
  ip: "an IP address",
  image: "an image link",
  phone: "a phone number",
  wallet: "a crypto wallet",
  name: "a person's name",
};

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const BTC_RE = /^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/;
const EMAIL_RE = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})$/i;
const USERNAME_RE = /^@?[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9_])?$/i;
const NAME_RE = /^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*)+$/u;
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|tiff?)$/i;

/**
 * Top-level domains common enough that "word.tld" is far more likely a website than a
 * dotted username. Anything else with a dot ("ada.fixture") is read as a username;
 * the user can always change the guess.
 */
const COMMON_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "dev",
  "app",
  "co",
  "ai",
  "me",
  "info",
  "biz",
  "xyz",
  "tech",
  "site",
  "online",
  "cloud",
  "page",
  "blog",
  "edu",
  "gov",
  "mil",
  "int",
  "uk",
  "us",
  "ca",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "be",
  "ch",
  "at",
  "se",
  "no",
  "dk",
  "fi",
  "pl",
  "pt",
  "ie",
  "eu",
  "au",
  "nz",
  "jp",
  "cn",
  "in",
  "br",
  "mx",
  "ru",
  "za",
  "pk",
  "sg",
  "hk",
  "kr",
  "tv",
  "gg",
  "ly",
  "so",
  "sh",
  "fm",
  "to",
  "cc",
  "ws",
  "example",
  "test",
  "invalid",
  "localhost",
]);

function looksLikeUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Guess what kind of identifier a free-text search is. Pure and order-sensitive:
 * the most specific shapes (URLs, wallets, emails, IPs) are tried before the loose
 * ones (phone, domain, name, username). Returns `null` when nothing fits.
 */
export function detectTarget(input: string): Detection | null {
  const value = input.trim();
  if (!value) return null;
  const hit = (type: TargetType): Detection => ({ type, label: DETECTION_LABEL[type] });

  const url = looksLikeUrl(value);
  if (url) return hit(IMAGE_EXT_RE.test(url.pathname) ? "image" : "domain");

  if (EVM_RE.test(value) || BTC_RE.test(value)) return hit("wallet");
  if (!value.startsWith("@") && EMAIL_RE.test(value)) return hit("email");
  if (isIPv4(value) || isIPv6(value.toLowerCase())) return hit("ip");

  if (PHONE_CHARS_RE.test(value)) {
    const digits = value.replace(/\D/g, "");
    const formatted = value.startsWith("+") || /[\s().-]/.test(value);
    if (digits.length >= 7 && digits.length <= 15 && (formatted || digits.length >= 10)) {
      return hit("phone");
    }
  }

  const host = value.toLowerCase().replace(/\/.*$/, "").replace(/\.$/, "");
  const tld = HOST_RE.exec(host)?.[1];
  if (tld && (COMMON_TLDS.has(tld) || host.split(".").length > 2)) return hit("domain");

  if (NAME_RE.test(value) && !/\d/.test(value)) return hit("name");
  if (USERNAME_RE.test(value)) return hit("username");
  return null;
}
