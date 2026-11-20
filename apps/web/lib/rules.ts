export interface RuleDescription {
  title: string;
  /** One plain-English sentence explaining what the rule means. */
  summary: string;
  /** The yes/no question asked when a person checks a link of this kind. */
  question: string;
}

export const DEFAULT_QUESTION = "Do these belong to the same person?";

const AVATAR: RuleDescription = {
  title: "Same profile picture",
  summary:
    "The profile pictures look the same according to a visual fingerprint (not face recognition).",
  question: "Is this the same profile picture?",
};
const BIO: RuleDescription = {
  title: "Matching bio text",
  summary: "The profile descriptions use the same or almost the same distinctive wording.",
  question: "Is this the same bio written by the same person?",
};
const NAME: RuleDescription = {
  title: "Same display name",
  summary: "These accounts show the same display name. Common names make this weak on its own.",
  question: "Is this the same display name for the same person?",
};

const RULES: Record<string, RuleDescription> = {
  same_account: {
    title: "One account, several sources",
    summary:
      "Several searches or data sources describe the same account, so it is shown once. Split it if that is wrong.",
    question: "Are these really one account?",
  },
  shared_email: {
    title: "Same email address",
    summary: "These accounts publish, or are found with, the same email address.",
    question: "Do these accounts share the same email address?",
  },
  shared_url: {
    title: "Same website linked",
    summary: "These accounts all link to the same personal website or page.",
    question: "Do these profiles point to the same website?",
  },
  shared_external_handle: {
    title: "One profile names the other account",
    summary: "One profile links to or names an account that was also found in this case.",
    question: "Does one profile really point to the other account?",
  },
  shared_display_name: NAME,
  shared_bio_text: BIO,
  avatar_match: AVATAR,
  breach_overlap: {
    title: "In the same breach",
    summary:
      "Different identifiers of this case appear in the same breach (exposure metadata only).",
    question: "Is this the same address appearing in several breaches?",
  },
  manual_link: {
    title: "Linked by you",
    summary: "You linked these accounts by hand.",
    question: "Do these belong to the same person?",
  },
  // older rule names still found in stored rows
  shared_email_platform: {
    title: "Email registered where it is published",
    summary: "A profile publishes an email that is registered on the same site.",
    question: "Do these belong to the same person?",
  },
  username_reuse: {
    title: "Same username on several platforms",
    summary: "These accounts use an identical handle, which often means one owner.",
    question: "Is this the same person using one handle on several sites?",
  },
  username_variation: {
    title: "Similar usernames",
    summary: "The handles differ only slightly (a separator, a digit or a suffix).",
    question: "Are these slightly different handles used by the same person?",
  },
  shared_avatar: AVATAR,
  shared_bio: BIO,
  shared_name: NAME,
  shared_location: {
    title: "Same stated location",
    summary: "These profiles state the same location. Weak evidence on its own.",
    question: "Do these profiles share a location because they are the same person?",
  },
};

export function describeRule(type: string): RuleDescription {
  const known = RULES[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return {
    title: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Something in common",
    summary: "These results have a detail in common. Look at the evidence before deciding.",
    question: DEFAULT_QUESTION,
  };
}

// ------------------------------------------------------------------ evidence field labels
const SEARCHED: Record<string, string> = {
  email: "Searched email",
  username: "Searched username",
  domain: "Searched website",
  ip: "Searched IP address",
  phone: "Searched phone number",
  name: "Searched name",
  image: "Searched image",
  wallet: "Searched wallet",
  scraped_url: "Page that was read",
};

const FIELD_LABELS: Record<string, string> = {
  email: "Email shown on profile",
  emails: "Email shown on profile",
  public_email: "Email shown on profile",
  business_email: "Email shown on profile",
  contact_email: "Email shown on profile",
  gravatar_email: "Email shown on profile",
  emails_in_page: "Email on the page",
  urls_in_page: "Link on the page",
  handles_in_page: "Handle on the page",
  links: "Links on profile",
  link: "Links on profile",
  website: "Website on profile",
  blog: "Website on profile",
  homepage: "Website on profile",
  url: "Link on profile",
  urls: "Links on profile",
  external_url: "Website on profile",
  bio: "Bio",
  about: "Bio",
  description: "Bio",
  fullname: "Display name",
  full_name: "Display name",
  name: "Display name",
  display_name: "Display name",
  location: "Location",
  avatar_phash: "Profile picture",
  phash: "Profile picture",
  avatar_hash: "Profile picture",
  breach_name: "Breach",
  data_classes: "Exposed data",
  stealer_family: "Infostealer log",
  data: "Crawler result",
  contributed: "Adds",
};

const PLATFORM_FIELD =
  /^(twitter|x|github|gitlab|instagram|youtube|tiktok|linkedin|telegram|mastodon|facebook|twitch|reddit|keybase|bluesky|medium|threads)(?:_(?:username|handle|user|url|profile|account))?$/;

/** "extra.public_repos" -> "Public repos" */
export function prettifyField(field: string): string {
  const words = field
    .replace(/^(extra|meta|media)\./, "")
    .replace(/[_.-]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Detail";
}

/**
 * Human label for an evidence field. `identifierType` is the type of the finding the
 * evidence comes from, so "identifier_value" reads "Searched email" or "Searched username".
 */
export function evidenceLabel(field: string, identifierType?: string): string {
  if (field === "identifier_value") return SEARCHED[identifierType ?? ""] ?? "What was searched";
  const key = field.replace(/^(extra|meta|media)\./, "").toLowerCase();
  const known = FIELD_LABELS[key];
  if (known) return known;
  const platform = PLATFORM_FIELD.exec(key);
  if (platform) {
    const name =
      platform[1] === "twitter" || platform[1] === "x" ? "X" : prettifyField(platform[1]!);
    return `${name} account named on profile`;
  }
  return prettifyField(field);
}

export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
