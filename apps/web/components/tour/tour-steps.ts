/** The first-run tour of the demo investigation. Each step points at a real element. */

export const TOUR_HREF = "/demo?tour=1";

export interface TourStep {
  /** `[data-tour="…"]` to anchor to, with a section id as fallback. */
  target: string;
  fallback: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "rail",
    fallback: "scan",
    title: "Your progress at a glance",
    body: "Every investigation has three steps: we scan public sources, you check the links we suggest, and the report is ready. Click a step to jump to it.",
  },
  {
    target: "summary",
    fallback: "summary",
    title: "The short version",
    body: "One sentence on what was found, an exposure score that says how much a stranger could piece together, and the first things to fix.",
  },
  {
    target: "link-question",
    fallback: "links",
    title: "Do these belong to the same person?",
    body: "We suggest links between results and explain why. Answer yes or no, or press Y and N. Only your yes counts towards the score and report.",
  },
  {
    target: "next-steps",
    fallback: "next",
    title: "Where to go next",
    body: "Emails, websites and handles mentioned in the results become one-click searches, each with the reason it is suggested.",
  },
  {
    target: "advanced",
    fallback: "summary",
    title: "Need the technical detail?",
    body: "Turn on Advanced to see data-source ids, queues, attempts, rule ids and the raw data behind every result. Nothing is hidden for good.",
  },
];
