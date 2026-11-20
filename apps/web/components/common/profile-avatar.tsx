"use client";

import { useState, type CSSProperties } from "react";
import { initials, monogramHue } from "@/lib/brand-colour";
import { safeImageUrl } from "@/lib/findings";
import { cn } from "@/lib/utils";
import { PlatformIcon, type PlatformIconSize } from "./platform-icon";

const SIZES = {
  xs: { box: "h-7 w-7 rounded-md text-[10px]", badge: "xs", offset: "-bottom-1 -right-1" },
  sm: { box: "h-10 w-10 rounded-lg text-xs", badge: "xs", offset: "-bottom-1 -right-1" },
  md: { box: "h-14 w-14 rounded-xl text-base", badge: "sm", offset: "-bottom-1.5 -right-1.5" },
  lg: { box: "h-20 w-20 rounded-2xl text-xl", badge: "md", offset: "-bottom-2 -right-2" },
  xl: { box: "h-28 w-28 rounded-2xl text-2xl", badge: "md", offset: "-bottom-2 -right-2" },
} as const satisfies Record<string, { box: string; badge: PlatformIconSize; offset: string }>;
export type AvatarSize = keyof typeof SIZES;

/**
 * Whether to try the picture: a safe URL that has not failed to load. Many hosts refuse
 * hot-linked pictures, so a failed load falls back to initials for good.
 */
export function avatarState(
  src: string | null | undefined,
  failed: string | null,
): { url: string | null; showImage: boolean } {
  const url = safeImageUrl(src ?? null);
  return { url, showImage: url !== null && url !== failed };
}

/**
 * A profile picture in a fixed square (no layout shift), with initials on a neutral tint
 * when there is none or it fails to load, and the platform as a small badge on the corner.
 * The image is loaded straight from its host, without a referrer, never proxied or stored.
 */
export function ProfileAvatar({
  src,
  name,
  platform,
  url,
  size = "md",
  className,
  decorative = false,
  onImageError,
}: {
  src: string | null | undefined;
  /** Person or account name: alt text and initials. */
  name: string;
  /** Badge the platform on the corner. */
  platform?: string | null;
  /** Profile URL, to resolve the platform badge when the name is unknown. */
  url?: string | null;
  size?: AvatarSize;
  className?: string;
  /** When the name is already written next to it, keep screen readers from repeating it. */
  decorative?: boolean;
  /** Called once when the picture fails to load (initials are shown instead). */
  onImageError?: (url: string) => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const { url: imageUrl, showImage } = avatarState(src, failed);
  const s = SIZES[size];
  const hue = monogramHue(name || "?");
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "relative flex items-center justify-center overflow-hidden border border-border bg-[hsl(var(--av-hue)_16%_90%)] font-semibold text-[hsl(var(--av-hue)_20%_32%)] dark:bg-[hsl(var(--av-hue)_12%_17%)] dark:text-[hsl(var(--av-hue)_20%_78%)]",
          s.box,
        )}
        style={{ "--av-hue": hue } as CSSProperties}
        role={decorative || showImage ? undefined : "img"}
        aria-label={decorative || showImage ? undefined : name}
        aria-hidden={decorative || undefined}
      >
        <span aria-hidden>{initials(name)}</span>
        {showImage && imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party avatar hosts, never proxied
          <img
            src={imageUrl}
            alt={decorative ? "" : `Profile picture of ${name}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              setFailed(imageUrl);
              onImageError?.(imageUrl);
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
      </span>
      {platform ? (
        <PlatformIcon
          platform={platform}
          url={url}
          size={s.badge}
          className={cn("absolute shadow-sm ring-2 ring-card", s.offset)}
        />
      ) : null}
    </span>
  );
}
