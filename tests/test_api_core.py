# tests/test_api.py
import pytest
import responses
from fviewer.api import FViewer


@pytest.fixture
def viewer():
    """Fixture to provide a clean FViewer instance for each test."""
    return FViewer(host="127.0.0.1", port=8000)


def test_initialization_urls():
    """Test that base URLs and headers are constructed correctly."""
    v1 = FViewer(host="localhost", port=9000)
    assert v1.base_url == "http://localhost:9000/api"

    v2 = FViewer(base_url="https://jupyter.remote/fviewer/api")
    assert v2.base_url == "https://jupyter.remote/fviewer/api"


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
def test_send_handles_server_errors(viewer):
    """Test that HTTP 400 errors from the server are raised as RuntimeErrors.
    """
    viewer.client_id = "test_client"

    # Mock the server returning an error (e.g. invalid region)
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
