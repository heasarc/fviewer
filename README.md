# FViewer: Quickstart Guide

Welcome to **FViewer**, a modern, browser-based astronomical FITS file viewer designed to replace traditional desktop tools like `fv` and `ds9`. 

FViewer provides a fast, hardware-accelerated web UI combined with a powerful bidirectional Python API, allowing you to control the viewer and extract data directly from your Jupyter Notebooks.

## Installation & Setup

Ensure you have FViewer installed in your current Python environment:

```bash
pip install fviewer
```

Start the FViewer backend server and UI in your terminal (or it may be auto-started by your JupyterHub environment):
```bash
fviewer
```
This will automatically open a browser window to the application at `http://127.0.0.1:8000`.

You specify custom host and port by passing them to the command line.

Calling `fviewer` with a file name will load it automatically.

---

## Python API Tutorial

The easiest way to use FViewer is alongside a Jupyter Notebook. This allows you to load files, adjust image parameters, and retrieve drawn regions programmatically.

### 1. Connect to the Viewer
First, import the client and connect it to your open browser tab.

```python
from fviewer import FViewer

# Initialize the client (defaults to localhost:8000)
viewer = FViewer()

# Block execution until the browser tab is open and connected
viewer.wait_for_ready(timeout=15)
```

### 2. Load a FITS File
Use the `load_file` method to open a FITS file. 
*Note: For security reasons, the file path must be relative to the directory where you started the FViewer server.*

```python
# Loads the file into the UI and automatically displays the Primary HDU
viewer.load_file("data/m51_chandra.fits")
```

### 3. Adjust Image Settings
You can easily adjust the image scaling and colormap to highlight different features in your astronomical data.

```python
# Check current settings
print("Current Colormap:", viewer.get_colormap())

# Apply a new stretch and colormap
viewer.set_stretch("log")
viewer.set_colormap("plasma") # Options: 'gray', 'heat', 'cool', 'plasma'
```

### 4. Programmatic Regions
You can push mathematical regions from your Python code directly to the FViewer canvas.

```python
# Draw a red circle at Pixel X=500, Y=500 with a radius of 50
viewer.add_circle(x=500, y=500, radius=50, color="#ff0000")

# Draw an elliptical background region
viewer.add_ellipse(
    x=450, y=450, rx=100, ry=50, 
    angle=45, color="#00ffff", 
    is_background=True
)
```

### 5. Extracting Data Back to Jupyter
If you draw regions manually using your mouse in the FViewer UI, you can instantly pull those coordinates back into Python for analysis.

```python
# Retrieve all drawn regions in World Coordinate System (RA/Dec)
regions = viewer.get_regions(format="fk5")

for reg in regions:
    print(f"Type: {reg['type']}, RA: {reg['ra']:.5f}, Dec: {reg['dec']:.5f}")

# Save the current UI regions to a DS9-compatible .reg file on disk
viewer.save_regions("my_science_regions.reg", format="fk5")
```

---

## User Interface Overview

If you prefer to work manually, the FViewer UI is designed like a compact Desktop IDE:

* **Left Sidebar (HDU List):** Shows all extensions in your FITS file. Clicking an `IMAGE` extension opens the image viewer. Clicking a `BINTABLE` extension opens the massive-scale Virtual Table.
* **Image Viewer:** 
  * **Pan/Zoom:** Use your mouse wheel to zoom in/out natively. Click and drag to pan around the image.
  * **Regions:** Use the `Regions` dropdown to select drawing tools (Circle, Box, Ellipse, Annulus). Click and drag on the image to draw. Select a region and press `Delete` to remove it.
  * **Status Bar:** Look at the bottom of the screen to see real-time Pixel coordinates, Flux values, and WCS (RA/Dec) coordinates.
* **Virtual Table:** Double-click any cell to edit it. The table uses lazy-loading, meaning you can scroll through millions of rows instantly without crashing your browser.
* **Right Sidebar (Plotter):** Toggle the plotter using the top menu to create interactive 1D Histograms and 2D Scatter plots based on your table data or image regions.
