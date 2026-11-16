# Copyright 2026, University of Maryland, All Rights Reserved

"""
Upload Plugin for FViewer.

Provides temporary in-memory storage for FITS file uploads from the Python
client. This allows ``load_file`` to accept astropy HDUList objects: the
client serializes the HDUList to bytes, uploads them here, and the frontend
fetches from the one-time-use download URL.

Uploads are deleted immediately after the first retrieval.  A background
cleanup task purges any stale (unfetched) entries after a configurable
interval (default 10 minutes).
"""

import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

# 2 GB default, overridable via environment variable (bytes)
MAX_UPLOAD_BYTES = int(os.getenv("FVIEWER_MAX_UPLOAD_BYTES",
                                 str(2 * 1024 * 1024 * 1024)))

# Stale upload cleanup threshold in seconds (default 10 minutes)
CLEANUP_SECONDS = int(os.getenv("FVIEWER_UPLOAD_CLEANUP_SECONDS", "600"))

router = APIRouter()


@dataclass
class UploadEntry:
    data: bytes
    filename: str
    created_at: float = field(default_factory=time.time)


_uploads: Dict[str, UploadEntry] = {}


def _purge_stale() -> None:
    """Remove uploads older than ``CLEANUP_SECONDS``."""
    cutoff = time.time() - CLEANUP_SECONDS
    stale = [uid for uid, entry in _uploads.items()
             if entry.created_at < cutoff]
    for uid in stale:
        _uploads.pop(uid, None)


@router.post("/api/upload")
async def upload_fits(file: UploadFile):
    """
    Accept a FITS file upload and store it in memory.

    Returns the ``upload_id`` that the frontend will use to retrieve the
    bytes exactly once via ``GET /api/upload/{upload_id}``.
    """
    # Purge stale entries on every upload to bound memory
    _purge_stale()

    data = await file.read()

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(f"Upload exceeds the {MAX_UPLOAD_BYTES} byte limit.")
        )

    upload_id = str(uuid.uuid4())
    filename = file.filename or "memory.fits"
    _uploads[upload_id] = UploadEntry(data=data, filename=filename)

    return {"upload_id": upload_id}


@router.get("/api/upload/{upload_id}")
async def download_upload(upload_id: str):
    """
    Serve a previously uploaded FITS blob and delete it from memory.

    This is a one-time retrieval endpoint: the entry is removed
    immediately after the bytes are returned.
    """
    entry = _uploads.pop(upload_id, None)

    if entry is None:
        raise HTTPException(status_code=404, detail="Upload not found.")

    return Response(
        content=entry.data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{entry.filename}"'
        },
    )
