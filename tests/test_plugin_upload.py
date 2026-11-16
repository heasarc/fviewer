# tests/test_plugin_upload.py
import time
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fviewer.server_plugins.upload import router, _uploads, UploadEntry

# --- Fixtures ---


@pytest.fixture(autouse=True)
def clear_uploads():
    """Ensure the in-memory store is empty before and after each test."""
    _uploads.clear()
    yield
    _uploads.clear()


@pytest.fixture
def client():
    """Sets up a minimal FastAPI app with the upload router."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def fits_bytes():
    """Minimal valid FITS-like payload for testing."""
    return b"SIMPLE  =                    T" + b" " * 50


# --- POST /api/upload Tests ---


def test_upload_returns_upload_id(client, fits_bytes):
    """A valid upload returns a JSON body with an upload_id."""
    resp = client.post(
        "/api/upload",
        files={"file": ("test.fits", fits_bytes, "application/octet-stream")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "upload_id" in body
    assert isinstance(body["upload_id"], str)


def test_upload_stores_data(client, fits_bytes):
    """The uploaded bytes are retrievable from the internal store."""
    resp = client.post(
        "/api/upload",
        files={"file": ("obs.fits", fits_bytes, "application/octet-stream")},
    )
    upload_id = resp.json()["upload_id"]
    assert upload_id in _uploads
    assert _uploads[upload_id].data == fits_bytes
    assert _uploads[upload_id].filename == "obs.fits"


def test_upload_size_limit(client, monkeypatch):
    """Uploads exceeding the max size are rejected with 413."""
    import fviewer.server_plugins.upload as mod
    monkeypatch.setattr(mod, "MAX_UPLOAD_BYTES", 10)

    resp = client.post(
        "/api/upload",
        files={"file": ("big.fits", b"x" * 20, "application/octet-stream")},
    )
    assert resp.status_code == 413
    assert "limit" in resp.json()["detail"].lower()


# --- GET /api/upload/{upload_id} Tests ---


def test_download_returns_bytes(client, fits_bytes):
    """Downloading a valid upload_id returns the raw bytes."""
    resp = client.post(
        "/api/upload",
        files={"file": ("test.fits", fits_bytes, "application/octet-stream")},
    )
    upload_id = resp.json()["upload_id"]

    dl = client.get(f"/api/upload/{upload_id}")
    assert dl.status_code == 200
    assert dl.content == fits_bytes
    assert "test.fits" in dl.headers.get("content-disposition", "")


def test_download_deletes_entry(client, fits_bytes):
    """After the first download the entry is removed (one-time retrieval)."""
    resp = client.post(
        "/api/upload",
        files={"file": ("test.fits", fits_bytes, "application/octet-stream")},
    )
    upload_id = resp.json()["upload_id"]

    # First fetch succeeds
    assert client.get(f"/api/upload/{upload_id}").status_code == 200

    # Second fetch returns 404
    assert client.get(f"/api/upload/{upload_id}").status_code == 404


def test_download_unknown_id_returns_404(client):
    """Requesting a non-existent upload_id returns 404."""
    resp = client.get("/api/upload/does-not-exist")
    assert resp.status_code == 404


# --- Stale cleanup Tests ---


def test_stale_entries_are_purged(client, monkeypatch):
    """Entries older than CLEANUP_SECONDS are removed on the next upload."""
    import fviewer.server_plugins.upload as mod
    monkeypatch.setattr(mod, "CLEANUP_SECONDS", 0)

    # Seed a stale entry manually
    _uploads["old"] = UploadEntry(
        data=b"old", filename="old.fits", created_at=time.time() - 1
    )

    # Trigger cleanup via a new upload
    client.post(
        "/api/upload",
        files={"file": ("new.fits", b"new", "application/octet-stream")},
    )

    assert "old" not in _uploads
