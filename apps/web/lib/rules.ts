export interface RuleDescription {
  title: string;
  /** One plain-English sentence explaining what the rule means. */
  summary: string;
}

const RULES: Record<string, RuleDescription> = {
  username_reuse: {
    title: "Same username on several platforms",
    summary: "These accounts use an identical handle, which often means one owner.",
  },
  username_variation: {
    title: "Similar usernames",
    summary: "The handles differ only slightly (a separator, a digit or a suffix).",
  },
  shared_email: {
    title: "Same email address",
    summary: "These profiles publish or are registered with the same email address.",
  },
  shared_url: {
    title: "Same website linked",
    summary: "These profiles all link to the same personal website or page.",
  },
  shared_external_handle: {
    title: "Profiles link to each other",
    summary: "One profile points to an account that matches another finding.",
  },
  shared_avatar: {
    title: "Same profile picture",
    summary: "The avatars are visually identical according to a perceptual hash (not face recognition).",
  },
  shared_bio: {
    title: "Matching bio text",
    summary: "The profile descriptions share distinctive wording.",
  },
  shared_name: {
    title: "Same display name",
    summary: "These profiles show the same display name.",
  },
  shared_location: {
    title: "Same stated location",
    summary: "These profiles state the same location. Weak evidence on its own.",
  },
  breach_overlap: {
    title: "Appears in several breaches",
    summary: "The same address shows up in more than one breach (exposure metadata only).",
  },
  manual_link: {
    title: "Linked by the investigator",
    summary: "You linked these findings manually.",
  },
};

export function describeRule(type: string): RuleDescription {
  const known = RULES[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return {
    title: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown rule",
    summary: "A correlation rule matched these findings.",
  };
}

export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
