"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { useData } from "@/components/providers/data-provider";
import { clearPhotoReminder, savePhotoReminder, takePhotoReminder } from "@/lib/pending-search";
import { useSession } from "@/lib/query/hooks";
import { requestSignIn } from "@/lib/sign-in-prompt";
import { hasAcknowledged } from "@/lib/storage";
import { PHOTO_NEEDS_SIGN_IN } from "@/lib/uploads";
import { usePhotoUpload } from "./use-photo-upload";

/**
 * The photo half of the search box: choosing (button, drop, paste), sign-in first, the one-time
 * acknowledgement, the upload, then `onUploaded(value)` with the `storage://` target value.
 *
 * Sign-in: the photo is kept in memory. When the dialog signs in without leaving the page the
 * search carries on; a sign-in page (email link, Google) cannot keep the photo, so a reminder
 * asks for it again afterwards.
 */
export function usePhotoSearch({
  enabled,
  pending,
  onUploaded,
  askAcknowledgement,
}: {
  enabled: boolean;
  /** The parent is starting the search (false again when it failed without navigating). */
  pending: boolean;
  onUploaded: (value: string) => void;
  /** Open the acknowledgement dialog; it calls `run()` once confirmed. */
  askAcknowledgement: () => void;
}) {
  const { ds } = useData();
  const session = useSession();
  const photo = usePhotoUpload();
  const state = photo.state;
  const [repick, setRepick] = useState(false);
  const [dragging, setDragging] = useState(false);
  const anonymous = session.data?.anonymous ?? true;

  const run = async () => {
    const uploaded = await photo.upload();
    if (uploaded) onUploaded(uploaded);
  };

  const submit = () => {
    if (ds.searchNeedsAccount && anonymous) {
      photo.needSignIn();
      savePhotoReminder();
      requestSignIn(PHOTO_NEEDS_SIGN_IN);
      return;
    }
    if (!hasAcknowledged()) return askAcknowledgement();
    void run();
  };

  const resume = useEffectEvent(() => {
    if (state.phase === "needs_sign_in" && !anonymous) {
      clearPhotoReminder();
      photo.signedIn();
      submit();
    } else if (enabled && state.phase === "idle" && takePhotoReminder(session.data)) {
      setRepick(true);
    }
  });
  useEffect(() => {
    const timer = setTimeout(resume, 0);
    return () => clearTimeout(timer);
  }, [session.data, state.phase]);

  // The search did not start after the upload (refused, offline): keep the photo for a retry.
  const sawPending = useRef(false);
  useEffect(() => {
    if (state.phase !== "starting") return;
    if (pending) sawPending.current = true;
    else if (sawPending.current) {
      sawPending.current = false;
      photo.failed("The search did not start. Your photo is still here, so you can try again.");
    }
  }, [pending, state.phase, photo]);

  const choose = (file: File | undefined) => {
    setRepick(false);
    photo.choose(file);
  };

  const formProps = enabled
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files[0]);
        },
        onPaste: (e: ClipboardEvent) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
          if (!file) return;
          e.preventDefault();
          choose(file);
        },
      }
    : {};

  return {
    state,
    active: enabled && state.phase !== "idle",
    busy: state.phase === "uploading" || state.phase === "starting",
    error: "error" in state ? state.error : null,
    repick,
    dragging,
    choose,
    clear: photo.clear,
    submit,
    run: () => void run(),
    formProps,
  };
}
