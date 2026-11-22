"use client";

import { useEffect, useReducer, useRef } from "react";
import { useData } from "@/components/providers/data-provider";
import { clearPhotoReminder } from "@/lib/pending-search";
import {
  IDLE,
  checkPhotoFile,
  classifyUploadError,
  hasExifGps,
  uploadReducer,
  type ChosenPhoto,
} from "@/lib/uploads";

/** The first bytes hold the EXIF block, which is all the location check needs. */
const HEAD_BYTES = 131_072;

/**
 * The photo chosen in the search box: validation, a thumbnail, an in-browser location check and
 * the upload itself (state machine in `lib/uploads.ts`). The photo lives only in memory.
 */
export function usePhotoUpload() {
  const { ds } = useData();
  const [state, dispatch] = useReducer(uploadReducer, IDLE);
  const preview = useRef<string | null>(null);

  const revoke = () => {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = null;
  };
  useEffect(() => revoke, []);

  const choose = async (file: File | null | undefined) => {
    if (!file) return;
    const check = checkPhotoFile(file);
    if (!check.ok) return dispatch({ type: "reject", error: check.error });
    let gps: boolean | null = null;
    try {
      gps = hasExifGps(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
    } catch {
      gps = null;
    }
    revoke();
    preview.current = URL.createObjectURL(file);
    const photo: ChosenPhoto = {
      file,
      previewUrl: preview.current,
      size: file.size,
      mime: file.type,
      gps,
    };
    dispatch({ type: "choose", photo });
  };

  const clear = () => {
    clearPhotoReminder();
    dispatch({ type: "clear" });
    revoke();
  };

  /** Uploads the chosen photo; resolves to the `storage://` target value, or null on failure. */
  const upload = async (): Promise<string | null> => {
    if (state.phase !== "chosen" && state.phase !== "needs_sign_in") return null;
    const photo = state.photo;
    if (state.phase === "chosen" && state.uploaded) {
      // already uploaded, only starting the search failed: reuse it rather than upload a copy
      dispatch({ type: "upload" });
      dispatch({ type: "uploaded", value: state.uploaded });
      return state.uploaded;
    }
    const ext = checkPhotoFile({ type: photo.mime, size: photo.size });
    if (!ext.ok) {
      dispatch({ type: "failed", error: ext.error });
      return null;
    }
    dispatch({ type: "upload" });
    try {
      const value = await ds.uploadPhoto(photo.file, ext.ext);
      clearPhotoReminder();
      dispatch({ type: "uploaded", value });
      return value;
    } catch (err) {
      dispatch({ type: "failed", error: classifyUploadError(err).message });
      return null;
    }
  };

  return {
    state,
    choose: (file: File | null | undefined) => void choose(file),
    clear,
    upload,
    needSignIn: () => dispatch({ type: "sign_in_required" }),
    signedIn: () => dispatch({ type: "signed_in" }),
    /** The search failed to start after the upload: back to the chosen photo with the reason. */
    failed: (error: string) => dispatch({ type: "failed", error }),
  };
}

export type PhotoUpload = ReturnType<typeof usePhotoUpload>;
