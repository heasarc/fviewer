# Copyright 2026, University of Maryland, All Rights Reserved

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

# Workspace root folder so the server browser does not go wandering
WORKSPACE_ROOT = Path(os.getenv("FVIEWER_WORKSPACE", Path.cwd())).resolve()

# Parse allowed external directories from the environment variable.
ALLOWED_ENV_DIRS = set()
_env_dirs = os.getenv("FVIEWER_ALLOWED_DIRS", "")
if _env_dirs:
    for p in _env_dirs.split(os.pathsep):
        if p.strip():
            ALLOWED_ENV_DIRS.add(Path(p.strip()).resolve())

router = APIRouter()


def _get_all_allowed_dirs(request: Request) -> set[Path]:
    """Combines environment allowed dirs with CLI-injected allowed dirs."""
    cli_dirs_str = getattr(request.app.state, "allowed_external_dirs", set())
    cli_dirs = {Path(p).resolve() for p in cli_dirs_str}
    return ALLOWED_ENV_DIRS | cli_dirs


def get_secure_path(user_path: str, request: Request) -> Path:
    """
    Validates that the requested path is safely within the WORKSPACE_ROOT
    or an allowed external directory.
    """
    target_path = (WORKSPACE_ROOT / user_path).resolve()

    # 1. Check if it's within the primary workspace
    if target_path.is_relative_to(WORKSPACE_ROOT):
        return target_path

    # 2. Check if it's within any of the allowed external directories
    for allowed_dir in _get_all_allowed_dirs(request):
        if target_path.is_relative_to(allowed_dir):
            return target_path

    # 3. If none match, deny access
    raise HTTPException(
        status_code=403, detail="Path traversal detected. Access denied."
    )


def _to_frontend_path(p: Path) -> str:
    """
    Converts a Path to a string for the React frontend.
    Keeps paths relative to the workspace if possible for cleaner URLs,
    otherwise uses the absolute path for external directories.
    """
    if p.is_relative_to(WORKSPACE_ROOT):
        return str(p.relative_to(WORKSPACE_ROOT))
    return str(p)


@router.get("/api/file")
async def serve_local_file(path: str, request: Request):
    """Securely streams a local file to the React frontend."""
    secure_path = get_secure_path(path, request)

    if not secure_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(secure_path)


@router.get("/api/fs/list")
def list_directory(request: Request, path: str = "."):
    """Returns the contents of a directory for the UI File Browser."""
    try:
        secure_path = get_secure_path(path, request)
    except HTTPException:
        raise HTTPException(status_code=403, detail="Permission denied")

    if not secure_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items = []
    try:
        # Determine the top-level "jail" boundary for the current path
        boundary = WORKSPACE_ROOT
        if not secure_path.is_relative_to(WORKSPACE_ROOT):
            for allowed_dir in _get_all_allowed_dirs(request):
                if secure_path.is_relative_to(allowed_dir):
                    boundary = allowed_dir
                    break

        # Add a "Go Up" option if not at the root/boundary
        if secure_path != boundary:
            items.append(
                {
                    "name": "..",
                    "path": _to_frontend_path(secure_path.parent),
                    "is_dir": True,
                }
            )

        for entry in secure_path.iterdir():
            # Skip hidden files
            if entry.name.startswith("."):
                continue

            is_dir = entry.is_dir()

            items.append(
                {
                    "name": entry.name,
                    "path": _to_frontend_path(entry),
                    "is_dir": is_dir,
                }
            )

        # Sort directories first, then alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return {
            "current_path": _to_frontend_path(secure_path),
            "items": items,
        }
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")


# Add this endpoint to fviewer/server_plugins/file_system.py

@router.get("/api/fs/roots")
def get_allowed_roots(request: Request):
    """Returns the workspace root and any external allowed directories."""
    roots = [{"name": "Workspace", "path": "."}]

    # Optional: Deduplicate names if multiple files are opened from
    # the same dir
    seen_paths = set()

    for ext_dir in _get_all_allowed_dirs(request):
        path_str = str(ext_dir)
        if path_str not in seen_paths:
            seen_paths.add(path_str)
            roots.append({
                "name": ext_dir.name or path_str,  # full path if no name
                "path": path_str
            })

    return {"roots": roots}
