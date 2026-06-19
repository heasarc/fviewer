# tests/test_api_core.py
import pytest
import responses
import json
from fviewer.api import FViewer


@pytest.fixture
def viewer():
    """Fixture to provide a clean FViewer instance for each test."""
    return FViewer(host="127.0.0.1", port=8000)


# --- Initialization Tests ---

def test_initialization_urls():
    """Test that base URLs and headers are constructed correctly."""
    v1 = FViewer(host="localhost", port=9000)
    assert v1.base_url == "http://localhost:9000/api"

    v2 = FViewer(base_url="https://jupyter.remote/fviewer/api")
    assert v2.base_url == "https://jupyter.remote/fviewer/api"


def test_initialization_jupyter_server_url(monkeypatch):
    """Test auto-discovery of URL via JUPYTER_SERVER_URL."""
    monkeypatch.setenv("JUPYTER_SERVER_URL", "http://jupyter-local:8888")
    v = FViewer()
    assert v.base_url == "http://jupyter-local:8888/fviewer/api"


def test_initialization_jupyterhub_service_url(monkeypatch):
    """Test auto-discovery of URL via JUPYTERHUB_SERVICE_URL."""
    monkeypatch.setenv(
        "JUPYTERHUB_SERVICE_URL", "https://hub.nasa.gov/user/user/")
    v = FViewer()
    assert v.base_url == "https://hub.nasa.gov/user/user/fviewer/api"


def test_initialization_missing_all_urls(monkeypatch):
    """Test default url if no URL or env vars are provided."""
    monkeypatch.delenv("JUPYTER_SERVER_URL", raising=False)
    monkeypatch.delenv("JUPYTERHUB_SERVICE_URL", raising=False)

    fv = FViewer()
    assert fv.base_url == 'http://127.0.0.1:8000/api'


def test_initialization_auth_token(monkeypatch):
    """Test that the Jupyter API token is injected into headers."""
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "secret_token_123")
    v = FViewer(host="localhost", port=8000)
    assert v.headers["Authorization"] == "token secret_token_123"


# --- API Command Tests ---

@responses.activate
def test_get_clients(viewer):
    """Test that get_clients correctly parses the server response."""
    responses.add(
        responses.GET,
        f"{viewer.base_url}/clients",
        json={"clients": ["browser_1", "browser_2"]},
        status=200
    )

    clients = viewer.get_clients()
    assert clients == ["browser_1", "browser_2"]


@responses.activate
def test_send_no_browser_connected(viewer):
    """Test that _send raises an error if no clients are available."""
    viewer.client_id = None

    # Mock /clients to return an empty list
    responses.add(
        responses.GET,
        f"{viewer.base_url}/clients",
        json={"clients": []},
        status=200
    )

    with pytest.raises(RuntimeError) as exc_info:
        viewer.load_file("test.fits")

    assert "No browser connected!" in str(exc_info.value)


@responses.activate
def test_send_handles_server_errors(viewer):
    """HTTP 400 errors from the server are raised as RuntimeErrors."""
    viewer.client_id = "test_client"

    # Mock the server returning an error
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"detail": "Invalid region format"},
        status=400
    )

    with pytest.raises(RuntimeError) as exc_info:
        viewer.clear_regions()

    assert "FViewer Error: Invalid region format" in str(exc_info.value)


@responses.activate
def test_load_file(viewer):
    """Test the specific load_file command payload."""
    viewer.client_id = "test_client"

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    result = viewer.load_file("data/my_image.fits")
    assert result["status"] == "ok"

    # Verify the payload sent to the backend
    request_body = json.loads(responses.calls[0].request.body)
    assert request_body["action"] == "load_file"
    assert request_body["path"] == "data/my_image.fits"


@responses.activate
def test_get_regions_format_validation(viewer):
    """Test that get_regions enforces local format validation."""
    viewer.client_id = "test_client"

    with pytest.raises(ValueError) as exc_info:
        # Invalid format string
        viewer.get_regions(format="galactic")

    assert "format must be" in str(exc_info.value)

    # Now test a valid format
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"regions": [{"type": "circle", "ra": 10.5}]},
        status=200
    )

    regions = viewer.get_regions(format="fk5")
    assert len(regions) == 1
    assert regions[0]["ra"] == 10.5


# --- Wait For Ready Tests ---

@responses.activate
def test_wait_for_ready_success(viewer):
    """Test successful connection after waiting."""

    # 1. Health check passes
    responses.add(
        responses.GET,
        f"{viewer.base_url}/health",
        json={"status": "OK"},
        status=200
    )

    # 2. Clients check returns a connected browser
    responses.add(
        responses.GET,
        f"{viewer.base_url}/clients",
        json={"clients": ["auto_client_1"]},
        status=200
    )

    # Call with tiny poll intervals to keep tests fast
    is_ready = viewer.wait_for_ready(timeout=2, poll_interval=0.01)

    assert is_ready is True
    assert viewer.client_id == "auto_client_1"


@responses.activate
def test_wait_for_ready_timeout(viewer):
    """Test TimeoutError is raised if server never comes up."""

    # Server returns 500 consistently
    responses.add(
        responses.GET,
        f"{viewer.base_url}/health",
        status=500
    )

    # Call with very tiny timeout
    with pytest.raises(TimeoutError) as exc_info:
        viewer.wait_for_ready(timeout=0.1, poll_interval=0.01)

    assert "timed out after 0.1 seconds" in str(exc_info.value)
