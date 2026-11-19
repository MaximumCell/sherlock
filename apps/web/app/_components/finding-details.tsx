"use client";
/** Renders a finding's extra_metadata in a structured, OSINT-friendly way.
 * Highlights bio/display_name matches for cross-platform correlation visibility.
 * Also surfaces all extracted pivots (emails, URLs, external handles) so the
 * investigator can follow the trail to other accounts.
 */
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icon";
import type { Finding } from "@/lib/api";

interface FindingDetailsProps {
  finding: Finding;
  /** Set of values that match across other findings in the case (for highlight). */
  crossLinks?: { display_names: Set<string>; bios: Set<string> };
  /** Compact mode for table rows vs. full card mode. */
  compact?: boolean;
}

const DISPLAY_NAME_KEYS = ["display_name", "fullname", "name"] as const;
const BIO_KEYS = ["bio", "about", "description", "intro", "profile_text"] as const;
const HANDLE_KEY_MAP: Record<string, string> = {
  twitter: "twitter",
  twitter_username: "twitter",
  github: "github",
  instagram: "instagram",
  youtube: "youtube",
  tiktok: "tiktok",
  linkedin: "linkedin",
};

const URL_TO_PLATFORM: [string, string][] = [
  ["twitter.com/", "twitter"],
  ["x.com/", "twitter"],
  ["instagram.com/", "instagram"],
  ["github.com/", "github"],
  ["gitlab.com/", "gitlab"],
  ["linkedin.com/in/", "linkedin"],
  ["youtube.com/", "youtube"],
  ["youtu.be/", "youtube"],
  ["tiktok.com/", "tiktok"],
  ["medium.com/", "medium"],
  ["hackerone.com/", "hackerone"],
  ["reddit.com/user/", "reddit"],
  ["gravatar.com/", "gravatar"],
];

const GENERIC_URL_SEGMENTS = new Set([
  "channel", "user", "users", "in", "share", "intent", "home",
  "about", "explore", "search", "settings", "p", "reel", "reels",
  "stories", "story", "post", "posts", "status", "video", "videos",
]);

const SOCIAL_BIO_RE: [string, RegExp][] = [
  ["twitter", /\btwitter[:\s]+@?([A-Za-z0-9_]{1,15})\b/gi],
  ["twitter", /\bx\.com\/@?([A-Za-z0-9_]{1,15})\b/gi],
  ["instagram", /\binstagram[:\s]+@?([A-Za-z0-9._]{1,30})\b/gi],
  ["github", /\bgithub(?:\.com)?[:\s/]+@?([A-Za-z0-9\-]{1,39})\b/gi],
  ["linkedin", /\blinkedin\.com\/in\/([A-Za-z0-9\-]{3,100})\b/gi],
  ["youtube", /\byoutube(?:\.com)?[:\s/@]+([A-Za-z0-9._\-]{1,30})\b/gi],
  ["tiktok", /\btiktok(?:\.com)?[:\s/@]+@?([A-Za-z0-9._]{2,24})\b/gi],
  ["telegram", /\btelegram[:\s/]+@?([A-Za-z0-9_]{4,32})\b/gi],
  ["mastodon", /\bmastodon\.social\/@([A-Za-z0-9._\-]{1,30})\b/gi],
];

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /https?:\/\/[^\s<>"',;]+/g;

// Mirror of core/extract.py — keep in sync. Used to surface pivots in the UI.
function extractPivotsClient(extra: Record<string, unknown>, bio: string): Pivots {
  const emails = new Set<string>();
  const urls = new Set<string>();
  const handles: { platform: string; handle: string }[] = [];

  const emailFields = ["email", "business_email", "emails", "gravatar_email"];
  for (const f of emailFields) {
    const v = extra[f];
    if (typeof v === "string" && v.includes("@")) {
      for (const e of v.split(",")) {
        const t = e.trim().toLowerCase();
        if (t) emails.add(t);
      }
    } else if (Array.isArray(v)) {
      for (const e of v) {
        if (typeof e === "string" && e.includes("@")) emails.add(e.trim().toLowerCase());
      }
    }
  }

  const urlFields = ["website", "external_url", "links", "blog", "url", "channel_url"];
  for (const f of urlFields) {
    const v = extra[f];
    if (typeof v === "string") {
      for (const piece of v.split(",")) {
        const t = piece.trim();
        if (t.startsWith("http")) urls.add(t.replace(/[.,;:!?)>'"]+$/, ""));
      }
      for (const m of v.matchAll(URL_RE)) {
        urls.add(m[0].replace(/[.,;:!?)>'"]+$/, ""));
      }
    } else if (Array.isArray(v)) {
      for (const u of v) if (typeof u === "string") urls.add(u.replace(/[.,;:!?)>'"]+$/, ""));
    }
  }

  for (const [field, plat] of Object.entries(HANDLE_KEY_MAP)) {
    const v = extra[field];
    if (typeof v === "string" && v.trim()) handles.push({ platform: plat, handle: v.trim().replace(/^@/, "") });
  }

  if (bio) {
    for (const m of bio.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());
    for (const m of bio.matchAll(URL_RE)) {
      urls.add(m[0].replace(/[.,;:!?)>'"]+$/, ""));
    }
    for (const [plat, pat] of SOCIAL_BIO_RE) {
      for (const m of bio.matchAll(pat)) handles.push({ platform: plat, handle: m[1].replace(/^@/, "") });
    }
  }

  for (const u of [...urls]) {
    for (const [needle, plat] of URL_TO_PLATFORM) {
      if (!u.includes(needle)) continue;
      const after = u.split(needle)[1] ?? "";
      const parts = after.split("/").filter(Boolean);
      if (parts.length === 0) break;
      // YouTube /channel/UC... → use the channel ID, not "channel"
      if (needle === "youtube.com/" && parts[0]?.toLowerCase() === "channel" && parts.length >= 2) {
        const channelId = parts[1].split("?")[0].split("#")[0];
        if (channelId.startsWith("UC")) handles.push({ platform: plat, handle: channelId });
        break;
      }
      // YouTube /@handle → use the @handle
      if (needle === "youtube.com/" && parts[0]?.startsWith("@")) {
        handles.push({ platform: plat, handle: parts[0].slice(1) });
        break;
      }
      const seg = parts[0].split("?")[0].split("#")[0].replace(/^@/, "").trim();
      if (seg && !GENERIC_URL_SEGMENTS.has(seg.toLowerCase())) {
        handles.push({ platform: plat, handle: seg });
      }
      break;
    }
  }

  return { emails: [...emails], urls: [...urls], handles };
}

interface Pivots {
  emails: string[];
  urls: string[];
  handles: { platform: string; handle: string }[];
}

function getAvatar(meta: Record<string, unknown>): string | null {
  const m = (meta.media as Record<string, unknown>) || {};
  const extra = (meta.extra as Record<string, unknown>) || {};
  return (m.avatar as string) ?? (m.image as string) ?? (extra.avatar as string) ?? (extra.image as string) ?? null;
}

function getDisplayName(f: Finding, extra: Record<string, unknown>): string | null {
  for (const k of DISPLAY_NAME_KEYS) {
    const v = extra[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function getBio(f: Finding, extra: Record<string, unknown>): string | null {
  for (const k of BIO_KEYS) {
    const v = extra[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

const STATS_LABELS: Record<string, string> = {
  followers: "followers",
  following: "following",
  public_repos: "public repos",
  public_gists: "public gists",
  posts: "posts",
  pins: "pins",
  boards: "boards",
  uid: "UID",
  id: "ID",
  is_verified: "verified",
  private: "private",
  joined: "joined",
  created: "created",
  created_at: "created",
  subscriber: "subscribers",
  subscribers: "subscribers",
  follower_count: "followers",
  following_count: "following",
  facebook_uid: "FB UID",
  is_business: "business",
  is_joined_recently: "new",
};

function buildStats(extra: Record<string, unknown>): { label: string; value: string }[] {
  const stats: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (k === "avatar" || k === "image") continue;
    if (k in STATS_LABELS && v !== null && v !== undefined && v !== "") {
      const val = typeof v === "string" ? v : String(v);
      if (val.length < 80) stats.push({ label: STATS_LABELS[k], value: val });
    }
  }
  return stats;
}

function getUrlFromString(s: string): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^https?:\/\//);
  return m ? s : null;
}

export function FindingDetails({ finding, crossLinks, compact }: FindingDetailsProps) {
  const meta = finding.extra_metadata || {};
  const extra = (meta.extra as Record<string, unknown>) || {};
  const avatar = getAvatar(meta);
  const displayName = getDisplayName(finding, extra);
  const bio = getBio(finding, extra);
  const stats = buildStats(extra);
  const isVerified = extra.is_verified === true || extra.is_verified === "true";
  const isPrivate = extra.private === true || extra.private === "True" || extra.private === "true";

  // Structured metadata fields
  const website = typeof extra.website === "string" ? extra.website : null;
  const email = typeof extra.email === "string" ? extra.email : null;
  const businessEmail = typeof extra.business_email === "string" ? extra.business_email : null;
  const location = typeof extra.location === "string" ? extra.location : null;
  const company = typeof extra.company === "string" ? extra.company : null;
  const orgs = typeof extra.organizations === "string" ? extra.organizations : null;
  const links = typeof extra.links === "string" ? extra.links : null;
  const channelUrl = typeof extra.channel_url === "string" ? extra.channel_url : null;

  // Pivots
  const pivots = extractPivotsClient(extra, bio ?? "");

  const displayNameMatches = displayName && crossLinks?.display_names.has(displayName);
  const bioMatches = bio && crossLinks?.bios.has(bio);
  const profileUrl = (meta.url as string) || channelUrl || website || null;

  // "Found via email registration only" — no rich profile data, just a match.
  // Show a compact layout with clear call-to-action.
  const isEmailMatch = finding.identifier_type === "email" && !avatar && !displayName && !bio;
  const hasAnyRichData = !!(avatar || displayName || bio || website || email || location || company || pivots.emails.length || pivots.urls.length || pivots.handles.length);

  if (compact) {
    return (
      <div style={{ minWidth: 0 }}>
        {displayName && displayName !== finding.identifier_value && (
          <div className={displayNameMatches ? "cross-link" : ""} style={{ fontSize: 11, fontWeight: 500 }}>
            {displayName}
            {displayNameMatches && <CrossLinkBadge />}
          </div>
        )}
        {bio && <div className="muted" style={{ fontSize: 11, fontStyle: "italic", marginTop: 2 }}>{bio.slice(0, 80)}{bio.length > 80 ? "…" : ""}</div>}
      </div>
    );
  }

  // Compact "email registration only" view: no rich profile data, but it's a
  // meaningful match (the platform confirmed the email is registered there).
  if (isEmailMatch) {
    return (
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span
            className="badge found"
            style={{ width: 28, height: 28, borderRadius: "50%", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            title="Found via email registration check — no public profile data"
          >
            <Icon name="check" size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {finding.platform}
              <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                · email registered
              </span>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
              <span className="mono">{finding.identifier_value}</span> is registered on this platform — but the public profile isn't linked to the email lookup, so no avatar/bio was returned.
            </div>
          </div>
          {profileUrl && (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn secondary"
              style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
              title={`Open ${finding.platform} homepage`}
            >
              <Icon name="external" size={12} />
              Open
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      {/* Top row: avatar + display name + badges + profile link */}
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={36}
            height={36}
            onError={(e) => {
              // CORS / hotlink / dead link — swap to a coloured initial so the
              // row never looks broken. Targets the most common offender:
              // Instagram's fbcdn.net avatars block cross-origin loads.
              const t = e.currentTarget;
              t.onerror = null;
              t.style.display = "none";
              const sib = t.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "inline-flex";
            }}
            style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "var(--color-muted)" }}
          />
        ) : null}
        {avatar ? (
          <span
            aria-hidden="true"
            style={{
              display: "none",
              width: 36,
              height: 36,
              borderRadius: "50%",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 600,
              background: "var(--color-accent-soft, hsl(var(--accent) / 0.15))",
              color: "var(--color-accent, hsl(var(--accent)))",
              border: "1px solid var(--color-border-soft)",
            }}
          >
            {(displayName || finding.platform || "??").slice(0, 2).toUpperCase()}
          </span>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          {displayName && displayName !== finding.identifier_value && (
            <div
              className={displayNameMatches ? "cross-link" : ""}
              style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}
            >
              {displayName}
              {displayNameMatches && <CrossLinkBadge />}
            </div>
          )}
          <div className="row" style={{ gap: 4, marginTop: 2, flexWrap: "wrap" }}>
            {(meta.category as string) && <span className="badge muted" style={{ fontSize: 9 }}>{meta.category as string}</span>}
            {isVerified && <span className="badge good" style={{ fontSize: 9 }}>verified</span>}
            {isPrivate && <span className="badge warn" style={{ fontSize: 9 }}>private</span>}
          </div>
        </div>
        {profileUrl && (
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            title={profileUrl}
          >
            <Icon name="external" size={12} />
            Profile
          </a>
        )}
      </div>

      {/* Bio */}
      {bio && (
        <p
          className={bioMatches ? "cross-link" : ""}
          style={{ margin: "10px 0 0", fontSize: 12.5, fontStyle: "italic", color: "var(--color-foreground)", opacity: 0.85 }}
        >
          {bio}
          {bioMatches && <CrossLinkBadge inline />}
        </p>
      )}

      {/* Profile metadata: website, email, location, company, etc. */}
      {(website || email || businessEmail || location || company || orgs || links) && (
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "4px 16px",
            fontSize: 12,
          }}
        >
          {website && (
            <MetaRow icon="link" label="website" value={website} href={getUrlFromString(website) ?? `https://${website}`} />
          )}
          {email && <MetaRow icon="mail" label="email" value={email} href={`mailto:${email}`} />}
          {businessEmail && businessEmail !== email && (
            <MetaRow icon="mail" label="business" value={businessEmail} href={`mailto:${businessEmail}`} />
          )}
          {location && <MetaRow icon="pin" label="location" value={location} />}
          {company && <MetaRow icon="info" label="company" value={company} />}
          {orgs && <MetaRow icon="info" label="orgs" value={orgs} mono />}
          {links && (
            <MetaRow
              icon="link"
              label="links"
              value={links}
              isLinksList
            />
          )}
        </div>
      )}

      {/* Pivots: emails, urls, external handles — the "connect dots" panel */}
      {pivots.emails.length + pivots.urls.length + pivots.handles.length > 0 && (
        <div
          style={{
            marginTop: 10,
            borderTop: "1px solid var(--color-border-subtle)",
            paddingTop: 10,
          }}
        >
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <Icon name="branch" size={11} />
            <span
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              Pivots — follow the trail
            </span>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 5 }}>
            {pivots.emails.map((e) => (
              <a
                key={`e-${e}`}
                href={`mailto:${e}`}
                className="badge muted pivot-chip"
                title={`Open mailto: ${e}`}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <Icon name="mail" size={10} /> {e}
              </a>
            ))}
            {pivots.urls
              .filter((u) => u !== website && u !== profileUrl)
              .map((u) => (
                <a
                  key={`u-${u}`}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge muted pivot-chip"
                  title={u}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                >
                  <Icon name="link" size={10} /> {u.replace(/^https?:\/\//, "").slice(0, 40)}
                </a>
              ))}
            {pivots.handles
              .filter((h, i, arr) => arr.findIndex((x) => x.platform === h.platform && x.handle === h.handle) === i)
              .map((h, i) => (
                <Link
                  key={`h-${h.platform}-${h.handle}-${i}`}
                  href={`/?pivot=${encodeURIComponent(h.handle)}&type=username`}
                  className="badge info pivot-chip"
                  title={`Investigate ${h.platform}:${h.handle} in a new case`}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                >
                  <Icon name="at" size={10} /> {h.platform}:{h.handle}
                </Link>
              ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      {stats.length > 0 && (
        <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          {stats.map((s) => (
            <div key={s.label} style={{ fontSize: 11 }}>
              <span className="muted" style={{ marginRight: 4 }}>{s.label}:</span>
              <span className="mono" style={{ fontSize: 11 }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Scraped data panel — shown when the finding was created via the enrichment endpoint */}
      {finding.source_tool === "firecrawl" && (
        <ScrapedPanel extra={extra} />
      )}
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
  href,
  mono,
  isLinksList,
}: {
  icon: "link" | "mail" | "pin" | "info";
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
  isLinksList?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 6, alignItems: "baseline", minWidth: 0 }}>
      <Icon name={icon} size={11} />
      <span className="muted" style={{ fontSize: 10.5, textTransform: "lowercase", flexShrink: 0 }}>
        {label}:
      </span>
      {isLinksList ? (
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
          {value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((u, i) => (
              <a
                key={i}
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="mono"
                style={{ fontSize: 11 }}
                title={u}
              >
                {u.replace(/^https?:\/\//, "").slice(0, 40)}
                {i < value.split(",").length - 1 ? "" : ""}
              </a>
            ))}
        </span>
      ) : href ? (
        <a
          href={href}
          target={href.startsWith("mailto:") ? undefined : "_blank"}
          rel="noopener noreferrer"
          className={mono ? "mono" : ""}
          style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
          title={value}
        >
          {value}
        </a>
      ) : (
        <span
          className={mono ? "mono" : ""}
          style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function CrossLinkBadge({ inline }: { inline?: boolean }) {
  return (
    <span
      className="badge found"
      style={{
        fontSize: 9,
        marginLeft: inline ? 6 : 8,
        padding: "1px 6px",
        verticalAlign: inline ? "middle" : undefined,
      }}
      title="Same value found on another platform — likely the same person"
    >
      <Icon name="check" size={9} /> match
    </span>
  );
}

/** Render the metadata extracted by the Firecrawl enrichment endpoint. */
function ScrapedPanel({ extra }: { extra: Record<string, unknown> }) {
  const title = typeof extra.title === "string" ? extra.title : null;
  const description = typeof extra.description === "string" ? extra.description : null;
  const ogImage = typeof extra.og_image === "string" ? extra.og_image : null;
  const author = typeof extra.author === "string" ? extra.author : null;
  const language = typeof extra.language === "string" ? extra.language : null;
  const scrapedAt = typeof extra.scraped_at === "string" ? extra.scraped_at : null;
  const scrapedUrl = typeof extra.scraped_url === "string" ? extra.scraped_url : null;
  const mdLen = typeof extra.markdown_length === "number" ? extra.markdown_length : null;
  const mdPreview = typeof extra.markdown_preview === "string" ? extra.markdown_preview : "";
  const emails = typeof extra.emails_in_page === "string" ? extra.emails_in_page.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const handles = typeof extra.handles_in_page === "string" ? extra.handles_in_page.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const urls = typeof extra.urls_in_page === "string" ? extra.urls_in_page.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const [showMd, setShowMd] = useState(false);

  // If the scrape returned nothing useful (some sites block scrapers, JS-only
  // pages, etc.), skip the noisy "scraped · 0 chars" panel and show a clear
  // empty state instead.
  const hasContent = !!(title || description || ogImage || mdLen || emails.length || handles.length || urls.length || mdPreview);
  if (!hasContent && scrapedUrl) {
    return (
      <div
        style={{
          marginTop: 12,
          borderTop: "1px solid var(--color-border-soft)",
          paddingTop: 10,
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <span className="badge cyan" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}>
          <Icon name="link" size={9} /> scraped
        </span>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          The scrape of{" "}
          <a href={scrapedUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ wordBreak: "break-all" }}>
            {scrapedUrl}
          </a>{" "}
          returned no extractable content. The site may require login, render content via JavaScript after load, or block automated scrapers (Instagram, Twitter/X, and a few others fall in this category).
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: "1px solid var(--color-border-soft)",
        paddingTop: 10,
      }}
    >
      <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span
          className="badge cyan"
          style={{ fontSize: 9, padding: "1px 6px" }}
          title="Generated by web scraping enrichment"
        >
          <Icon name="link" size={9} />
          scraped
        </span>
        {scrapedAt && (
          <span className="muted mono" style={{ fontSize: 10 }}>
            {new Date(scrapedAt).toLocaleString()}
          </span>
        )}
        {mdLen !== null && (
          <span className="muted" style={{ fontSize: 10 }}>
            · {mdLen.toLocaleString()} chars
          </span>
        )}
        <span className="spacer" />
        {mdPreview && (
          <button
            type="button"
            onClick={() => setShowMd((v) => !v)}
            className="ghost"
            style={{ fontSize: 10, padding: "2px 6px" }}
          >
            <Icon name={showMd ? "x" : "info"} size={9} />
            {showMd ? "Hide" : "Preview"}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {scrapedUrl && (
          <a
            href={scrapedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ fontSize: 11.5, wordBreak: "break-all" }}
            title={scrapedUrl}
          >
            {scrapedUrl}
            <Icon name="external" size={10} style={{ marginLeft: 4, opacity: 0.6 }} />
          </a>
        )}
        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ogImage}
            alt={title ?? "preview"}
            style={{ maxWidth: 200, borderRadius: 6, border: "1px solid var(--color-border-soft)" }}
          />
        )}
        {title && (
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        )}
        {description && (
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{description}</div>
        )}
        {author && (
          <div className="muted" style={{ fontSize: 11 }}>
            <span className="muted">by</span> {author}{language ? ` · ${language}` : ""}
          </div>
        )}
        {showMd && mdPreview && (
          <pre
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 240,
              overflow: "auto",
              padding: 10,
              background: "var(--color-tertiary)",
              border: "1px solid var(--color-border-soft)",
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}
          >
            {mdPreview}
            {mdLen && mdPreview.length < mdLen ? "\n\n…(truncated)" : ""}
          </pre>
        )}

        {emails.length + handles.length + urls.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Extracted from page
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {emails.map((e) => (
                <a key={`e-${e}`} href={`mailto:${e}`} className="badge muted" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  <Icon name="mail" size={9} /> {e}
                </a>
              ))}
              {handles.map((h) => (
                <span key={`h-${h}`} className="badge cyan" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  <Icon name="at" size={9} /> {h}
                </span>
              ))}
              {urls.slice(0, 6).map((u) => (
                <a
                  key={`u-${u}`}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge muted"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={u}
                >
                  <Icon name="link" size={9} /> {u.replace(/^https?:\/\//, "").slice(0, 30)}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Build the cross-link sets from a list of findings. */
export function buildCrossLinks(findings: Finding[]): { display_names: Set<string>; bios: Set<string> } {
  const displayNames = new Map<string, number>();
  const bios = new Map<string, number>();
  for (const f of findings) {
    if (f.status !== "found") continue;
    const extra = (f.extra_metadata?.extra as Record<string, unknown>) || {};
    const dn = getDisplayName(f, extra);
    const bio = getBio(f, extra);
    if (dn) displayNames.set(dn, (displayNames.get(dn) ?? 0) + 1);
    if (bio) bios.set(bio, (bios.get(bio) ?? 0) + 1);
  }
  return {
    display_names: new Set([...displayNames.entries()].filter(([, c]) => c > 1).map(([n]) => n)),
    bios: new Set([...bios.entries()].filter(([, c]) => c > 1).map(([b]) => b)),
  };
}
