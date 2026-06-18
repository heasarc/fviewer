import json
import pytest
import responses
from fviewer.api import FViewer


@pytest.fixture
def viewer():
    """Fixture to provide a clean FViewer instance for each test."""
    return FViewer(host="127.0.0.1", port=8000)


@responses.activate
def test_set_slice_single_integer(viewer):
    """Test that passing a single integer converts to a list correctly."""
    # Mock get_clients for auto-connect
    responses.add(
        responses.GET,
        f"{viewer.base_url}/clients",
        json={"clients": ["auto_client_1"]},
        status=200
    )
    # Mock the command response
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.set_slice(42)

    assert viewer.client_id == "auto_client_1"
    post_call = responses.calls[1].request
    assert "client_id=auto_client_1" in post_call.url

    payload = json.loads(post_call.body)
    assert payload["action"] == "set_slice"
    assert payload["sliceIndices"] == [42]


@responses.activate
def test_set_slice_list(viewer):
    """Test that passing a list of indices works for 4D/5D cubes."""
    viewer.client_id = "test_client"  # Set explicitly to skip auto-connect

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.set_slice([42, 5])

    post_call = responses.calls[0].request
    payload = json.loads(post_call.body)
    assert payload["action"] == "set_slice"
    assert payload["sliceIndices"] == [42, 5]


@responses.activate
def test_get_slice_returns_indices(viewer):
    """Test that get_slice parses the returned slice indices from React."""
    viewer.client_id = "test_client"

    # Mock the frontend returning the current slice state
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"sliceIndices": [42, 5]},
        status=200
    )

    current_slice = viewer._send("get_slice").get("sliceIndices")

    post_call = responses.calls[0].request
    payload = json.loads(post_call.body)
    assert payload["action"] == "get_slice"
    assert current_slice == [42, 5]
