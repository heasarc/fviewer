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
