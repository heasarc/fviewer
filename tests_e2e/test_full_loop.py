# tests_e2e/test_full_loop.py
import os
import pytest
import subprocess
import time
import requests
from playwright.sync_api import Page, expect
from fviewer import FViewer

# Define the port for our test server
TEST_PORT = 8123
TEST_HOST = '127.0.0.1'
BASE_URL = f"http://{TEST_HOST}:{TEST_PORT}"


@pytest.fixture(scope="module", autouse=True)
def start_test_server():
    """Starts the FastAPI server in a background process for
    the duration of the tests."""

    process = subprocess.Popen(
        ["uv", "run", "uvicorn", "fviewer.server:app",
         "--host", TEST_HOST, "--port", str(TEST_PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    server_up = False
    for _ in range(30):  # 15 seconds max wait
        try:
            res = requests.get(f"{BASE_URL}/api/health")
            if res.status_code == 200:
                server_up = True
                break
        except requests.ConnectionError:
            pass
        time.sleep(0.5)

    if not server_up:
        process.terminate()
        raise RuntimeError("Test server failed to start")

    yield  # Let the tests run!

    process.terminate()
    process.wait()


def load_image(page: Page):
    """Load an image. Factor common code"""

    page.goto(BASE_URL)
    viewer = FViewer(host=TEST_HOST, port=TEST_PORT)
    viewer.wait_for_ready()

    # 1. Load the file via API (simulating user clicking Open File)
    viewer.load_file("frontend/tests/data/test_im.fits")

    # 2. Verify Canvas Mounts
    # The canvas element should appear once the WASM worker finishes rendering
    canvas = page.locator("canvas").first
    expect(canvas).to_be_visible(timeout=5000)
    return viewer


def test_api_driven_loop(page: Page):
    """Test the complete stack: Browser -> WebSocket ->
    Python API -> UI Update."""

    viewer = load_image(page)

    # wait for the image to be loaded
    expect(page.locator("button[title='Colormap']")).to_be_visible()

    viewer.set_colormap("plasma")
    assert viewer.get_colormap() == "plasma"

    # API driven drawing
    viewer.add_circle(x=100, y=100, radius=20, color="#ff0000")

    regions = viewer.get_regions(format="image")
    assert len(regions) >= 1
    assert regions[-1]["type"] == "circle"
    assert regions[-1]["startX"] == 100
    assert regions[-1]["startY"] == 100
    assert regions[-1]["color"] == '#ff0000'
    assert regions[-1]["angle"] == 0
    assert not regions[-1]["isBackground"]

    svg_region = page.locator("svg circle").last
    expect(svg_region).to_be_attached()


def test_regions(page: Page):
    """Test the UX: User loads file -> Clicks toolbar -> Drags on
    canvas -> Python sees it."""

    viewer = load_image(page)

    # --------------------- #
    # Check basic rendering #
    expect(page.get_by_title("HDU 1")).to_be_visible()
    expect(page.get_by_text("SCI").filter(visible=True).first).to_be_visible()
    # --------------------- #

    # --------------------- #
    # --- Create regions -- #

    # Clear any existing regions so we start fresh
    viewer.clear_regions()

    # Simulate User Selecting the "Circle" Tool from the Menu
    # First, click the dropdown button to open the menu
    page.get_by_title("Regions Menu").click()
    # Then, click the "Circle" option inside the dropdown
    page.get_by_text("Circle", exact=True).click()

    # Create a circle region
    page.mouse.move(750, 300)  # somewhere close to the center
    page.mouse.down()
    page.mouse.move(800, 350, steps=5)
    page.mouse.up()

    # wait for React to do its thing
    time.sleep(0.5)

    regions = viewer.get_regions(format="image")

    # Assert that the list contains exactly 1 region
    assert len(regions) == 1, f"Expected 1 region, got {len(regions)}"

    # Assert it recorded the correct type
    assert regions[0]["type"] == "circle"
    # --------------------- #

    # --------------------- #
    # --- Save regions ---- #
    for fmt in ['physical', 'image', 'fk5']:
        # save region from ui #
        page.get_by_title("Regions Menu").click()

        # select format
        menu = page.locator(".dropdown-menu")
        menu.locator("select").select_option(fmt)

        # Tell Playwright to wait for a download event
        with page.expect_download() as download_info:
            # Trigger the download by clicking the "Save" button
            page.get_by_role("button", name="Save").click()

        # Get the actual download object
        download = download_info.value
        assert download.suggested_filename.endswith(".reg")

        ui_region_file = download.path()

        # save region file from api
        api_region_file = 'region_api.reg'
        viewer.save_regions(api_region_file, format=fmt)

        with open(ui_region_file) as fp:
            region_ui = fp.read()

        with open(api_region_file) as fp:
            region_api = fp.read()
        os.remove(api_region_file)

        assert region_ui == region_api
    # ------------------- #

    # save region file to use later before clearing regions
    viewer.save_regions(api_region_file, format=fmt)

    # Clear all regions #
    page.get_by_title("Regions Menu").click()
    page.get_by_text("Clear All Regions").click()
    time.sleep(0.5)
    regions = viewer.get_regions(format="image")
    assert len(regions) == 0, f"Expected 0 region, got {len(regions)}"

    # load region from server #
    page.get_by_title("Regions Menu").click()
    page.get_by_text("Load Server Regions...").click()
    page.get_by_text(api_region_file).click()
    time.sleep(0.5)

    regions = viewer.get_regions(format="image")
    assert len(regions) == 1, f"Expected 1 region, got {len(regions)}"

    # clean up
    os.remove(api_region_file)


def test_colors(page: Page):
    """Test UX and python for Colormap"""

    viewer = load_image(page)

    # --------------------- #
    # Check basic rendering #
    expect(page.get_by_title("HDU 1")).to_be_visible()
    expect(page.get_by_text("SCI").filter(visible=True).first).to_be_visible()
    # --------------------- #

    assert viewer.get_colormap() == 'gray'

    for cmap in ['Heat', 'Cool', 'Plasma']:
        # change it from the UI
        page.get_by_title("Colormap").click()
        page.get_by_text(cmap).click()
        assert viewer.get_colormap() == cmap.lower()


def test_scale(page: Page):
    """Test UX and python for Scale"""

    viewer = load_image(page)

    # --------------------- #
    # Check basic rendering #
    expect(page.get_by_title("HDU 1")).to_be_visible()
    expect(page.get_by_text("SCI").filter(visible=True).first).to_be_visible()
    # --------------------- #

    assert viewer.get_stretch() == 'linear'
    for scale in ['Log', 'Square Root', 'ASINH']:
        # change it from the UI
        page.get_by_title("Scale / Stretch").click()
        page.get_by_text(scale, exact=True).click()
        assert viewer.get_stretch() == scale.lower()


def test_basic_plot(page: Page):
    """Plotting UI"""

    viewer = load_image(page)

    # --------------------- #
    # Check basic rendering #
    expect(page.get_by_title("HDU 1")).to_be_visible()
    expect(page.get_by_text("SCI").filter(visible=True).first).to_be_visible()
    # --------------------- #

    # Clear any existing regions so we start fresh
    viewer.clear_regions()

    # open the plotting panel
    page.get_by_title("Toggle Plotter").click()
    expect(page.get_by_text(
        "No region selected.", exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_text(
        "Region Histogram", exact=True)).to_be_hidden(timeout=5000)

    # add a region
    page.get_by_title("Regions Menu").click()
    page.get_by_text("Circle", exact=True).click()
    page.mouse.move(750, 300)  # somewhere close to the center
    page.mouse.down()
    page.mouse.move(800, 350, steps=5)
    page.mouse.up()

    # wait for React to do its thing
    time.sleep(0.5)

    expect(page.get_by_text(
        "Region Histogram", exact=True)).to_be_visible(timeout=5000)

    # click outside the region
    page.mouse.click(350, 400)
    expect(page.get_by_text(
        "Region Histogram", exact=True)).to_be_hidden(timeout=5000)
