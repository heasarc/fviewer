import json
import pytest
import responses
from fviewer.api import FViewer


@pytest.fixture
def viewer():
    viewer = FViewer(host="127.0.0.1", port=8000)
    viewer.client_id = "test_client"
    return viewer


@responses.activate
def test_get_regions_format_validation(viewer):
    with pytest.raises(ValueError) as exc_info:
        viewer.get_regions(format="galactic")

    assert "format must be" in str(exc_info.value)

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"regions": [{"type": "circle", "ra": 10.5}]},
        status=200
    )

    regions = viewer.get_regions(format="fk5")
    assert len(regions) == 1
    assert regions[0]["ra"] == 10.5


@responses.activate
def test_clear_regions(viewer):
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.clear_regions()
    payload = json.loads(responses.calls[0].request.body)
    assert payload["action"] == "clear_regions"


@responses.activate
def test_add_shapes(viewer):
    """Test all region drawing commands generate correct payloads."""
    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    # 1. Add Circle
    viewer.add_circle(x=10, y=20, radius=5)
    p1 = json.loads(responses.calls[0].request.body)
    assert p1["action"] == "add_region"
    assert p1["type"] == "circle"
    assert p1["radius"] == 5

    # 2. Add Box
    viewer.add_box(x=10, y=20, width=5, height=5, angle=45)
    p2 = json.loads(responses.calls[1].request.body)
    assert p2["type"] == "box"
    assert p2["width"] == 5
    assert p2["angle"] == 45

    # 3. Add Ellipse
    viewer.add_ellipse(x=10, y=20, rx=5, ry=3, is_background=True)
    p3 = json.loads(responses.calls[2].request.body)
    assert p3["type"] == "ellipse"
    assert p3["rx"] == 5
    assert p3["isBackground"] is True

    # 4. Add Annulus
    viewer.add_annulus(x=10, y=20, inner_r=5, outer_r=10)
    p4 = json.loads(responses.calls[3].request.body)
    assert p4["type"] == "annulus"
    assert p4["innerR"] == 5
    assert p4["outerR"] == 10


@responses.activate
def test_load_regions(viewer, tmp_path):
    """Test loading regions from a local file."""
    # Create a dummy region file
    reg_file = tmp_path / "test.reg"
    reg_file.write_text("circle(100, 100, 20)")

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"status": "ok"},
        status=200
    )

    viewer.load_regions(str(reg_file))

    payload = json.loads(responses.calls[0].request.body)
    assert payload["action"] == "load_regions_from_string"
    assert payload["content"] == "circle(100, 100, 20)"


@responses.activate
def test_save_regions_success(viewer, tmp_path):
    """Test successfully saving regions to a local file."""
    out_file = tmp_path / "output.reg"

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"content": "fk5\ncircle(10, 20, 5)"},
        status=200
    )

    result = viewer.save_regions(str(out_file), format="fk5")

    assert result["status"] == "ok"
    assert out_file.read_text() == "fk5\ncircle(10, 20, 5)"

    payload = json.loads(responses.calls[0].request.body)
    assert payload["action"] == "get_regions_string"
    assert payload["format"] == "fk5"


def test_save_regions_invalid_format(viewer, tmp_path):
    """Test format validation in save_regions."""
    out_file = tmp_path / "output.reg"

    with pytest.raises(ValueError) as exc:
        viewer.save_regions(str(out_file), format="galactic")
    assert "format must be" in str(exc.value)


def test_save_regions_invalid_extension(viewer, tmp_path):
    """Test security extension validation in save_regions."""
    out_file = tmp_path / "output.exe"

    with pytest.raises(ValueError) as exc:
        viewer.save_regions(str(out_file))
    assert "security" in str(exc.value)


@responses.activate
def test_save_regions_size_limit(viewer, tmp_path):
    """Test that extremely large region payloads are rejected."""
    out_file = tmp_path / "output.reg"

    # Mock a payload slightly larger than 5MB
    massive_string = "A" * ((5 * 1024 * 1024) + 10)

    responses.add(
        responses.POST,
        f"{viewer.base_url}/command",
        json={"content": massive_string},
        status=200
    )

    with pytest.raises(RuntimeError) as exc:
        viewer.save_regions(str(out_file))

    assert "exceeds 5MB limit" in str(exc.value)
