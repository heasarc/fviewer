# tests_e2e/test_full_loop.py
import pytest
import subprocess
import time
import requests
from playwright.sync_api import Page, expect
from fviewer.api import FViewer

# Define the port for our test server
TEST_PORT = 8123
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

@pytest.fixture(scope="module", autouse=True)
def start_test_server():
    """Starts the FastAPI server in a background process for the duration of the tests."""
    
    # Start the server using uvicorn
    # Make sure we point to the fviewer.server module
    process = subprocess.Popen(
        ["uv", "run", "uvicorn", "fviewer.server:app", "--host", "127.0.0.1", "--port", str(TEST_PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    # Wait for the server to become healthy
    server_up = False
    for _ in range(30): # 15 seconds max wait
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

    # Teardown: stop the server
    process.terminate()
    process.wait()

def test_full_application_loop(page: Page):
    """Test the complete stack: Browser -> WebSocket -> Python API -> UI Update."""
    
    # 1. Open the UI in the Playwright headless browser
    page.goto(BASE_URL)
    
    # Wait for the UI to load (e.g., looking for the top Menubar)
    # Adjust this selector based on actual text in your App.tsx Menubar
    expect(page.locator("text=File").first).to_be_visible()

    # 2. Instantiate our Python client
    # It should automatically connect to the Playwright browser session!
    viewer = FViewer(port=TEST_PORT)
    viewer.wait_for_ready()
    assert viewer.client_id is not None


    # Load a file
    viewer.load_file("frontend/tests/data/test_im.fits")
    
    
    # 3. Test a UI Command: Set Colormap
    # We send the command via Python...
    viewer.set_colormap("plasma")
    
    # ... and we assert that the React UI actually received it!
    # (Assuming you have a status bar or UI element that displays the current colormap)
    # If you don't have a visible element, we can query the Python API back:
    assert viewer.get_colormap() == "plasma"

    # 4. Test Region Drawing
    # We send a draw command...
    viewer.add_circle(x=100, y=100, radius=20, color="#ff0000")
    
    # ... check the Python API memory ...
    regions = viewer.get_regions(format="image")
    assert len(regions) == 1
    assert regions[0]["type"] == "circle"
    
    # ... and check the DOM! 
    # Your RegionOverlay.tsx renders SVGs. We can check if an SVG shape exists.
    # We wait for an SVG circle or rect element to appear on the screen.
    svg_region = page.locator("svg circle").first
    expect(svg_region).to_be_attached()
