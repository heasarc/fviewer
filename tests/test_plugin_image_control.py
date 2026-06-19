import json
import pytest
import responses
from fviewer.api import FViewer


@pytest.fixture
def viewer():
    return FViewer(host="127.0.0.1", port=8000)


@responses.activate
def test_set_colormap_sends_correct_payload(viewer):
    # Mock get_clients for auto-connect
    responses.add(
        responses.GET,
        f"{viewer.base_url}/clients",
        json={"clients": ["auto_client_1"]},
        status=200
    )
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.set_colormap("plasma")

    assert viewer.client_id == "auto_client_1"
    post_call = responses.calls[1].request
    assert "client_id=auto_client_1" in post_call.url

    payload = json.loads(post_call.body)
    assert payload["action"] == "set_colormap"
    assert payload["cmap"] == "plasma"


@responses.activate
def test_set_stretch_sends_correct_payload(viewer):
    """Test setting the image stretch."""
    viewer.client_id = "test_client"

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.set_stretch("log")

    post_call = responses.calls[0].request
    payload = json.loads(post_call.body)

    assert payload["action"] == "set_stretch"
    assert payload["stretch"] == "log"


@responses.activate
def test_get_colormap(viewer):
    """Test retrieving the current colormap."""
    viewer.client_id = "test_client"

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"colormap": "heat"},
        status=200
    )

    cmap = viewer.get_colormap()

    assert cmap == "heat"
    post_call = responses.calls[0].request
    payload = json.loads(post_call.body)
    assert payload["action"] == "get_colormap"


@responses.activate
def test_get_stretch(viewer):
    """Test retrieving the current stretch."""
    viewer.client_id = "test_client"

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"stretch": "sqrt"},
        status=200
    )

    stretch = viewer.get_stretch()

    assert stretch == "sqrt"
    post_call = responses.calls[0].request
    payload = json.loads(post_call.body)
    assert payload["action"] == "get_stretch"
