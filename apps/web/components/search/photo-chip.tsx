"use client";

import { Camera, MapPin, X } from "lucide-react";
import { useRef } from "react";
import { PHOTO_ACCEPT, PHOTO_REPICK_MESSAGE, formatBytes, type UploadState } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/** Hidden file input behind a button. On phones the picker offers the camera and the photo library. */
export function PhotoButton({
  onFile,
  compact = false,
  disabled = false,
}: {
  onFile: (file: File | undefined) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors duration-1 hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Camera className="h-3.5 w-3.5" aria-hidden />
        {compact ? "Photo" : "Upload a photo"}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a photo to search"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = ""; // choosing the same file again still fires
        }}
      />
    </>
  );
}

/** The chosen photo inside the search box: "Photo · 1.2 MB · change", upload progress, location note. */
export function PhotoChip({
  state,
  onChange,
  onRemove,
}: {
  state: Exclude<UploadState, { phase: "idle" }>;
  onChange: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const busy = state.phase === "uploading" || state.phase === "starting";
  const { photo } = state;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
      <div className="flex min-w-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a remote image */}
        <img
          src={photo.previewUrl}
          alt="The photo you chose"
          className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
        />
        <p className="min-w-0 text-sm leading-snug sm:text-base" data-testid="photo-chip">
          <span className="font-medium">Photo</span>
          <span className="text-muted-foreground"> · {formatBytes(photo.size)} · </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
          >
            change
          </button>
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label="Remove the photo"
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <input
          ref={input}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            onChange(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {busy ? (
        <div role="status" className="space-y-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn(
                "h-full rounded-full bg-accent transition-[width] duration-3",
                state.phase === "uploading" ? "w-2/3 animate-pulse" : "w-full",
              )}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {state.phase === "uploading"
              ? "Uploading your photo privately…"
              : "Uploaded. Starting the search…"}
          </span>
        </div>
      ) : photo.gps ? (
        <p className="flex items-center gap-1 text-xs text-warning">
          <MapPin className="h-3 w-3" aria-hidden />
          This photo contains location data. It stays private to you.
        </p>
      ) : null}
    </div>
  );
}

/** Back from a sign-in page: the photo could not come along. */
export function PhotoRepickNotice() {
  return (
    <p role="status" className="rounded-md border border-accent/30 bg-accent/[0.08] p-3 text-sm">
      {PHOTO_REPICK_MESSAGE}
    </p>
  );
}
