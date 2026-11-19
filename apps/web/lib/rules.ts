export interface RuleDescription {
  title: string;
  /** One plain-English sentence explaining what the rule means. */
  summary: string;
  /** The yes/no question asked when a person checks a link of this kind. */
  question: string;
}

export const DEFAULT_QUESTION = "Do these belong to the same person?";

const RULES: Record<string, RuleDescription> = {
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
  shared_email: {
    title: "Same email address",
    summary: "These profiles publish or are registered with the same email address.",
    question: "Do these accounts share the same email address?",
  },
  shared_url: {
    title: "Same website linked",
    summary: "These profiles all link to the same personal website or page.",
    question: "Do these profiles point to the same website?",
  },
  shared_external_handle: {
    title: "Profiles link to each other",
    summary: "One profile points to an account that matches another finding.",
    question: "Does one profile really point to the other account?",
  },
  shared_avatar: {
    title: "Same profile picture",
    summary:
      "The avatars are visually identical according to a perceptual hash (not face recognition).",
    question: "Is this the same profile picture?",
  },
  shared_bio: {
    title: "Matching bio text",
    summary: "The profile descriptions share distinctive wording.",
    question: "Is this the same bio written by the same person?",
  },
  shared_name: {
    title: "Same display name",
    summary: "These profiles show the same display name.",
    question: "Is this the same display name for the same person?",
  },
  shared_location: {
    title: "Same stated location",
    summary: "These profiles state the same location. Weak evidence on its own.",
    question: "Do these profiles share a location because they are the same person?",
  },
  breach_overlap: {
    title: "Appears in several breaches",
    summary: "The same address shows up in more than one breach (exposure metadata only).",
    question: "Is this the same address appearing in several breaches?",
  },
  manual_link: {
    title: "Linked by the investigator",
    summary: "You linked these findings manually.",
    question: "Do these belong to the same person?",
  },
};

export function describeRule(type: string): RuleDescription {
  const known = RULES[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return {
    title: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown rule",
    summary: "A correlation rule matched these findings.",
    question: DEFAULT_QUESTION,
  };
}

export function confidenceBand(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
