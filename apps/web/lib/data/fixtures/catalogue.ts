import type { ModuleInfo, Queue } from "../../types";

function mod(
  name: string,
  title: string,
  queue: Queue,
  inputs: string[],
  description: string,
  source_url: string | null,
  requires_env: string[] = [],
  available = true,
): ModuleInfo {
  return { name, title, description, inputs, queue, requires_env, available, source_url };
}

/** Bundled module catalogue: used in fixture mode and as the offline fallback for /modules. */
export const FIXTURE_MODULES: ModuleInfo[] = [
  mod(
    "user_scanner",
    "Username presence",
    "identity",
    ["username"],
    "Checks whether a handle is registered on a few hundred public platforms and collects the public profile fields each one exposes.",
    "https://github.com/kaifcodec/user-scanner",
  ),
  mod(
    "email_registrations",
    "Email registrations",
    "identity",
    ["email"],
    "Tests whether an email address is registered on public services using their sign-up and recovery flows. No login is attempted.",
    "https://github.com/megadose/holehe",
  ),
  mod(
    "gravatar",
    "Gravatar profile",
    "identity",
    ["email"],
    "Looks up the public Gravatar profile and avatar tied to an email hash.",
    "https://docs.gravatar.com/",
  ),
  mod(
    "xposedornot",
    "Breach exposure",
    "identity",
    ["email"],
    "Lists the breaches an email appears in: breach name, date and exposed data classes. Never the leaked records themselves.",
    "https://xposedornot.com/api_doc",
  ),
  mod(
    "phone_meta",
    "Phone number metadata",
    "identity",
    ["phone"],
    "Parses a number offline: validity, country, line type. It does not resolve a number to a person.",
    "https://github.com/daviddrysdale/python-phonenumbers",
  ),
  mod(
    "name_search",
    "Name search",
    "identity",
    ["name"],
    "Searches public web pages for a full name. Signed-in accounts only, rate-limited per day.",
    null,
    ["SEARCH_API_KEY"],
    false,
  ),
  mod(
    "dns_records",
    "DNS records",
    "infra",
    ["domain"],
    "Resolves A, AAAA, MX, NS and TXT records over DNS-over-HTTPS.",
    "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/",
  ),
  mod(
    "crtsh",
    "Certificate transparency",
    "infra",
    ["domain"],
    "Finds subdomains from certificates logged in public certificate transparency logs.",
    "https://crt.sh/",
  ),
  mod(
    "rdap",
    "Registration data (RDAP)",
    "infra",
    ["domain", "ip"],
    "Fetches registrar, registration dates and network ownership from RDAP, the successor to WHOIS.",
    "https://about.rdap.org/",
  ),
  mod(
    "internetdb",
    "Open ports",
    "infra",
    ["ip"],
    "Reads open ports, hostnames and tags for an address from a passive internet-wide scan index. Sherlock sends no packets to the host.",
    "https://internetdb.shodan.io/",
  ),
  mod(
    "wayback",
    "Web archive history",
    "infra",
    ["domain"],
    "Counts archived snapshots and finds the first and last capture of a site.",
    "https://archive.org/help/wayback_api.php",
  ),
  mod(
    "wallet_activity",
    "Wallet activity",
    "infra",
    ["wallet"],
    "Summarises public on-chain activity for an address: first and last transaction, counts and labelled counterparties.",
    "https://docs.etherscan.io/",
    ["ETHERSCAN_API_KEY"],
    false,
  ),
  mod(
    "avatar_phash",
    "Avatar perceptual hash",
    "media",
    ["image"],
    "Computes a 64-bit perceptual hash of an image so the same avatar can be matched across profiles. This is image similarity, not face recognition.",
    "https://github.com/JohannesBuchner/imagehash",
  ),
  mod(
    "exif",
    "Image metadata",
    "media",
    ["image"],
    "Reads embedded EXIF metadata such as capture device, software and timestamps. GPS coordinates are dropped.",
    "https://exiftool.org/",
  ),
];

export function modulesFor(targetType: string): ModuleInfo[] {
  return FIXTURE_MODULES.filter((m) => m.available && m.inputs.includes(targetType));
}
