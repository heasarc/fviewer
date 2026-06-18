# fviewer/tests/test_file_system.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from fviewer.server_plugins.file_system import router
import fviewer.server_plugins.file_system as fs_module


# --- Fixtures ---

@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """
    Creates a temporary workspace directory and monkeypatches
    the router's WORKSPACE_ROOT to point to it.
    """
    # Force the module's WORKSPACE_ROOT to be our tmp_path
    monkeypatch.setattr(fs_module, "WORKSPACE_ROOT", tmp_path.resolve())
    return tmp_path


@pytest.fixture
def client():
    """Sets up a dummy FastAPI app with our router for testing."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def dummy_filesystem(workspace):
    """Populates the temporary workspace with folders and dummy files."""
    # Create valid files
    (workspace / "valid.fits").touch()
    (workspace / "valid.fits.gz").touch()
    (workspace / "image.img").touch()

    # Create files that should be ignored
    (workspace / "invalid.txt").touch()
    (workspace / ".hidden.fits").touch()

    # Create a sub-directory
    sub_dir = workspace / "subfolder"
    sub_dir.mkdir()
    (sub_dir / "data.pha").touch()

    return workspace


# --- Tests for /api/file ---

def test_serve_local_file_success(client, dummy_filesystem):
    """Test successfully streaming a valid file."""
    response = client.get("/api/file?path=valid.fits")
    assert response.status_code == 200
    # The file is empty so content should be empty bytes
    assert response.content == b""


def test_serve_local_file_not_found(client, workspace):
    """Test 404 when file does not exist."""
    response = client.get("/api/file?path=missing.fits")
    assert response.status_code == 404
    assert "File not found" in response.json()["detail"]


def test_serve_local_file_is_directory(client, dummy_filesystem):
    """Test 404 when trying to stream a directory instead of a file."""
    response = client.get("/api/file?path=subfolder")
    assert response.status_code == 404
    assert "File not found" in response.json()["detail"]


def test_serve_local_file_path_traversal(client, workspace):
    """Test 403 when attempting a path traversal attack."""
    # Attempt to break out of the workspace
    response = client.get("/api/file?path=../etc/passwd")
    assert response.status_code == 403
    assert "Path traversal detected" in response.json()["detail"]


# --- Tests for /api/fs/list ---

def test_list_directory_root(client, dummy_filesystem):
    """Test listing the root directory (filtering applied, no '..' option)."""
    response = client.get("/api/fs/list?path=.")
    assert response.status_code == 200
    data = response.json()

    assert data["current_path"] == "."
    items = data["items"]

    # We should have exactly 4 items:
    # subfolder, image.img, valid.fits, valid.fits.gz
    # The invalid.txt and .hidden.fits must be filtered out!
    assert len(items) == 4

    # Check that sorting works (folders first, then alphabetical)
    assert items[0]["name"] == "subfolder"
    assert items[0]["is_dir"] is True

    # Verify no '..' in root
    names = [item["name"] for item in items]
    assert ".." not in names
    assert "valid.fits" in names
    assert "invalid.txt" not in names


def test_list_directory_subfolder(client, dummy_filesystem):
    """Test listing a subdirectory (should include '..' to go up)."""
    response = client.get("/api/fs/list?path=subfolder")
    assert response.status_code == 200
    data = response.json()

    assert data["current_path"] == "subfolder"
    items = data["items"]

    # Should contain '..' and 'data.pha'
    assert len(items) == 2

    assert items[0]["name"] == ".."
    assert items[0]["is_dir"] is True
    assert items[0]["path"] == "."  # parent of subfolder is root

    assert items[1]["name"] == "data.pha"
    assert items[1]["is_dir"] is False


def test_list_directory_not_found(client, workspace):
    """Test 404 when listing a non-existent directory."""
    response = client.get("/api/fs/list?path=ghost_folder")
    assert response.status_code == 404
    assert "Directory not found" in response.json()["detail"]


def test_list_directory_path_traversal(client, workspace):
    """Test 403 when trying to list directories outside workspace."""
    response = client.get("/api/fs/list?path=../../")
    assert response.status_code == 403
    assert "Permission denied" in response.json()["detail"]


def test_list_directory_permission_error(client, dummy_filesystem):
    """Test handling of OS-level PermissionError during iteration."""
    # We use unittest.mock.patch to force iterdir() to raise a PermissionError
    with patch("pathlib.Path.iterdir", side_effect=PermissionError):
        response = client.get("/api/fs/list?path=.")
        assert response.status_code == 403
        assert "Permission denied" in response.json()["detail"]
