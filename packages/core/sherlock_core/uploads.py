"""Photos a user uploaded for an image search.

The browser uploads to the private Supabase Storage bucket `media` under
`uploads/<auth uid>/<random uuid>.<ext>` and starts the search with the target value
`storage://media/uploads/<uid>/<file>`. Storage policies (0004_uploads.sql) let a user write and
read only their own folder; the gateway accepts the value only from that user; the media modules
read the object with the service key through the store, and hand search engines a short-lived
signed URL.

Signed URLs never leave the finding that needs them: not in logs, not in `search_log`, not in
job rows. Uploaded objects are deleted together with their case (`delete_case_uploads`).
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sherlock_core.store import UPLOAD_DISPLAY_VALUE, Store, get_store

log = logging.getLogger("sherlock.uploads")

SCHEME = "storage://"
BUCKET = "media"
MAX_BYTES = 8_000_000              # the bucket's file_size_limit, the browser check and image_meta's cap
SIGNED_URL_TTL_S = 3600            # links built from a signed URL stop working after an hour
DISPLAY_VALUE = UPLOAD_DISPLAY_VALUE  # how logs and the operator panel show the target ("uploaded photo")
EXTENSIONS = ("jpg", "png", "webp", "gif")

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# Strict on purpose: a fixed bucket and prefix, a user id, a random file name. Nothing else can
# match, so "..", "%2e", a second "/" or another bucket never gets through.
_UPLOAD = re.compile(rf"^storage://media/(uploads/({_UUID})/{_UUID}\.({'|'.join(EXTENSIONS)}))$")


@dataclass(frozen=True)
class Upload:
    path: str          # inside the bucket: uploads/<owner_id>/<file>
    owner_id: str
    extension: str
    bucket: str = BUCKET

    @property
    def value(self) -> str:
        return f"{SCHEME}{self.bucket}/{self.path}"


class UploadUnavailable(Exception):
    """The uploaded photo could not be read or signed (missing, too large, storage error).
    The message is fit for the user."""


def is_upload(value: Any) -> bool:
    """True for any `storage://` value, valid or not (so logs never show a raw storage path)."""
    return isinstance(value, str) and value.strip().lower().startswith(SCHEME)


def parse_upload(value: str) -> Upload:
    """The upload a target value names. Raises ValueError with a message fit for the user."""
    m = _UPLOAD.match((value or "").strip().lower())
    if not m:
        raise ValueError("uploaded photo reference is not valid (expected storage://media/uploads/<your id>/<file>)")
    path, owner, ext = m.groups()
    return Upload(path=path, owner_id=owner, extension=ext)


def display_target(target_type: str | None, value: Any) -> Any:
    """The value as logs show it: an uploaded photo is never shown by its storage path."""
    return DISPLAY_VALUE if target_type == "image" and is_upload(value) else value


def case_upload_paths(case: dict[str, Any], values: Iterable[Any] = ()) -> list[str]:
    """Object paths of the photos a case uses that belong to the case's owner.

    `values` are extra target values (job targets, entity values) besides the case identifiers.
    A path under another user's folder is never returned, so deleting a case can only ever
    remove its owner's own uploads.
    """
    owner = str(case.get("owner_id") or "").lower()
    candidates = [i.get("value") for i in case.get("identifiers") or [] if isinstance(i, dict)]
    candidates.extend(values)
    paths: list[str] = []
    for v in candidates:
        if not is_upload(v):
            continue
        try:
            up = parse_upload(v)
        except ValueError:
            continue
        if owner and up.owner_id == owner and up.path not in paths:
            paths.append(up.path)
    return paths


def delete_case_uploads(store: Store, case: dict[str, Any]) -> int:
    """Delete the uploaded photos of a case. Call BEFORE `store.delete_case` (it reads the case's
    jobs and entities). Never raises: a storage failure is logged and the case is still deleted."""
    try:
        case_id = case["id"]
        values: list[Any] = [j.get("target_value") for j in store.list_jobs(case_id)]
        values += [e.get("value") for e in store.list_entities(case_id) if e.get("kind") == "image"]
        paths = case_upload_paths(case, values)
        return store.delete_objects(BUCKET, paths) if paths else 0
    except Exception as e:
        log.warning("could not delete the uploaded photos of case %s: %s", case.get("id"), type(e).__name__)
        return 0


async def read_upload(value: str, *, max_bytes: int = MAX_BYTES) -> tuple[Upload, bytes]:
    """Download an uploaded photo with the service key. Raises UploadUnavailable."""
    up = parse_upload(value)
    try:
        data = await asyncio.to_thread(get_store().download_object, up.bucket, up.path, max_bytes=max_bytes)
    except ValueError as e:     # larger than max_bytes
        raise UploadUnavailable(f"the uploaded photo is {e}") from e
    except LookupError as e:
        raise UploadUnavailable("the uploaded photo no longer exists") from e
    except Exception as e:
        raise UploadUnavailable(f"could not read the uploaded photo (storage error {type(e).__name__})") from e
    return up, data


async def signed_upload_url(value: str, *, expires_s: int = SIGNED_URL_TTL_S) -> str:
    """A short-lived URL anyone can fetch the photo from (search engines need one).
    Keep it inside the finding that needs it; never log it. Raises UploadUnavailable."""
    up = parse_upload(value)
    try:
        return await asyncio.to_thread(get_store().create_signed_url, up.bucket, up.path, expires_s)
    except LookupError as e:
        raise UploadUnavailable("the uploaded photo no longer exists") from e
    except Exception as e:
        raise UploadUnavailable(f"could not sign the uploaded photo (storage error {type(e).__name__})") from e
