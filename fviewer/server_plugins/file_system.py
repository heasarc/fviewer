# Copyright 2026, University of Maryland, All Rights Reserved

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# Workspace root folder so the server browser does not go wandering
WORKSPACE_ROOT = Path(os.getenv("FVIEWER_WORKSPACE", Path.cwd())).resolve()

router = APIRouter()


def get_secure_path(user_path: str) -> Path:
    """
    Validates that the requested path is safely within the WORKSPACE_ROOT.

    This prevents Directory Traversal (Path Traversal) attacks by resolving
    all symlinks and `..` up-level references and ensuring the final
    absolute path remains inside the designated workspace.

    Args:
        user_path (str): The relative path requested by the user.

    Returns:
        Path: The resolved, absolute, and verified safe pathlib.Path object.

    Raises:
        HTTPException: 403 error if path traversal is detected.
    """
    target_path = (WORKSPACE_ROOT / user_path).resolve()

    if not target_path.is_relative_to(WORKSPACE_ROOT):
        raise HTTPException(
            status_code=403, detail="Path traversal detected. Access denied."
        )

    return target_path


@router.get("/api/file")
async def serve_local_file(path: str):
    """Securely streams a local file to the React frontend."""
    secure_path = get_secure_path(path)

    if not secure_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(secure_path)


@router.get("/api/fs/list")
def list_directory(path: str = "."):
    """Returns the contents of a directory for the UI File Browser."""
    try:
        secure_path = get_secure_path(path)
    except HTTPException:
        raise HTTPException(status_code=403, detail="Permission denied")

    if not secure_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    # Allowed astronomical extensions
    bases = [".fits", ".fit", ".arf", ".rmf", ".rsp", ".pha", ".img", ".reg"]
    extensions = tuple(f"{b}{x}" for b in bases for x in ["", ".gz"])

    items = []
    try:
        # Add a "Go Up" option if not at the root
        if secure_path != WORKSPACE_ROOT:
            items.append(
                {
                    "name": "..",
                    "path": str(
                        secure_path.parent.relative_to(WORKSPACE_ROOT)
                    ),
                    "is_dir": True,
                }
            )

        for entry in secure_path.iterdir():
            if entry.name.startswith("."):
                continue

            is_dir = entry.is_dir()

            if not is_dir and not entry.name.lower().endswith(extensions):
                continue

            items.append(
                {
                    "name": entry.name,
                    "path": str(entry.relative_to(WORKSPACE_ROOT)),
                    "is_dir": is_dir,
                }
            )

        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return {
            "current_path": str(secure_path.relative_to(WORKSPACE_ROOT)),
            "items": items,
        }
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
