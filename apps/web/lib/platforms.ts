/**
 * One display label per platform, whatever spelling a data source stored
 * ("github", "Github" and "GitHub" are all shown as "GitHub").
 */

// squashed name -> canonical id (mirrors the alias table in sherlock_core/correlation/norm.py)
const ALIASES: Record<string, string> = {
  x: "twitter",
  xtwitter: "twitter",
  twitterx: "twitter",
  gh: "github",
  ig: "instagram",
  insta: "instagram",
  yt: "youtube",
  fb: "facebook",
  tg: "telegram",
  bsky: "bluesky",
  hn: "hackernews",
  ycombinator: "hackernews",
  devcommunity: "devto",
  npmjs: "npm",
  docker: "dockerhub",
  steamcommunity: "steam",
  hudsonrock: "hudsonrock",
};

const LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  codeberg: "Codeberg",
  bitbucket: "Bitbucket",
  gravatar: "Gravatar",
  twitter: "X",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  telegram: "Telegram",
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  threads: "Threads",
  reddit: "Reddit",
  medium: "Medium",
  devto: "Dev.to",
  hackernews: "Hacker News",
  hackerone: "HackerOne",
  bugcrowd: "Bugcrowd",
  keybase: "Keybase",
  npm: "npm",
  pypi: "PyPI",
  dockerhub: "Docker Hub",
  stackoverflow: "Stack Overflow",
  kaggle: "Kaggle",
  replit: "Replit",
  codepen: "CodePen",
  huggingface: "Hugging Face",
  leetcode: "LeetCode",
  twitch: "Twitch",
  steam: "Steam",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  tumblr: "Tumblr",
  flickr: "Flickr",
  vimeo: "Vimeo",
  patreon: "Patreon",
  discord: "Discord",
  lichess: "Lichess",
  chesscom: "Chess.com",
  lastfm: "Last.fm",
  duolingo: "Duolingo",
  hudsonrock: "Hudson Rock",
};

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Canonical platform id for comparing names: "GitHub", "github" and "gh" are all "github". */
export function canonicalPlatform(name: string): string {
  const raw = name.trim().toLowerCase();
  const bare = raw.startsWith("scraped:") ? raw.slice("scraped:".length) : raw;
  const sq = squash(bare);
  return ALIASES[sq] ?? sq;
}

/** The one label shown for a platform. Unknown names keep the spelling the source used. */
export function platformLabel(name: string): string {
  return LABELS[canonicalPlatform(name)] ?? name;
}

/** Best label among several spellings of one platform: the known label, else the most deliberately capitalised. */
export function bestPlatformLabel(names: readonly string[]): string {
  const known = names.map((n) => LABELS[canonicalPlatform(n)]).find(Boolean);
  if (known) return known;
  const caps = (s: string) => (s.match(/[A-Z]/g) ?? []).length;
  return [...names].sort((a, b) => caps(b) - caps(a) || a.localeCompare(b))[0] ?? "";
}
