/** Plain-language helpers around the data-source (module) catalogue. */
import { FIXTURE_MODULES } from "./data/fixtures/catalogue";
import type { ModuleInfo, Queue, TargetType } from "./types";

const BUNDLED = new Map(FIXTURE_MODULES.map((m) => [m.name, m]));

/** Human title of a data source; falls back to the bundled catalogue, then the id. */
export function sourceTitle(name: string, live?: readonly ModuleInfo[]): string {
  const found = live?.find((m) => m.name === name) ?? BUNDLED.get(name);
  if (found) return found.title;
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** Data sources that can search one kind of target. */
export function sourcesFor(modules: readonly ModuleInfo[], type: TargetType): ModuleInfo[] {
  return modules.filter((m) => m.inputs.includes(type));
}

export const SOURCE_GROUPS: { id: string; title: string; types: TargetType[]; description: string }[] = [
  { id: "username", title: "Username", types: ["username"], description: "Where a handle is registered and what its public profiles say." },
  { id: "email", title: "Email", types: ["email"], description: "Sign-ups, public profiles and breach listings for an address." },
  { id: "web", title: "Website or IP", types: ["domain", "ip"], description: "DNS, certificates, registration, archived pages and exposed services." },
  { id: "image", title: "Image", types: ["image"], description: "File details and a visual fingerprint. No face recognition." },
  { id: "phone", title: "Phone", types: ["phone"], description: "What the number itself reveals. Never who owns it." },
  { id: "wallet", title: "Wallet", types: ["wallet"], description: "Public blockchain activity for an address." },
  { id: "name", title: "Name", types: ["name"], description: "Public pages that mention a full name. Requires sign-in." },
];

/** What each scan queue is about, in plain words (shown on the scan progress panel). */
export const QUEUE_LABEL: Record<Queue, string> = {
  identity: "Accounts & identity",
  infra: "Websites & servers",
  media: "Images",
};
