# The Python API

While FViewer's web interface is great for manual inspection, real astronomical workflows require automation. FViewer includes a powerful Python API that allows you to control the viewer, load files, and extract data programmatically.

Behind the scenes, your Python script communicates with the FViewer web interface securely. The commands you send in Python are instantly executed in the browser. Furthermore, the API is **synchronous**—meaning when you send a command to load an image, Python waits until the image is actually fully loaded on the screen before moving to the next line of code. This makes scripting highly predictable.

## Getting Started

To use the Python API, you simply import the `FViewer` class and create an instance. If the FViewer server isn't already running, this will connect to it (or you can run it alongside your script).

```python
from fviewer.api import FViewer

# Connect to the viewer
viewer = FViewer()
```

## A Flat, Discoverable Interface

FViewer uses a "flat" command structure. Instead of hunting through nested sub-modules (like `viewer.images.controls.set_colormap()`), every command is available directly on the `viewer` object. 

If you are using an IDE or an interactive prompt, you can simply type `viewer.` and press **Tab** to see a list of all available commands.

### Controlling the Viewer

You can drive almost every aspect of the FViewer UI directly from Python. Here is an example of loading an image and adjusting how it looks:

```python
# Open a FITS file located on your computer
viewer.load_file("data/galaxy_obs.fits")

# Change the visual appearance
viewer.set_colormap("plasma")
viewer.set_stretch("log")

# Zoom in and center on a specific coordinate
viewer.set_zoom(2.0)
viewer.pan_to(150.5, -12.3) # Pan to an X, Y pixel coordinate
```

### Working with Regions Programmatically

You don't have to draw regions by hand. You can inject regions into the viewer directly from your Python analysis, or extract regions that you drew manually on the screen back into Python.

```python
# Draw a circle on the image at pixel x=500, y=500 with a radius of 50
viewer.add_region("circle 500 500 50", color="red")

# Get a list of all regions currently drawn on the screen
my_regions = viewer.get_regions()

print(f"Found {len(my_regions)} regions on the image.")
```

### Extracting Data

FViewer isn't just a one-way street. Because the browser and Python are constantly talking, you can extract the data you are looking at in the UI directly into Python variables for further analysis.

```python
# Get the actual image data array currently displayed on screen
image_data = viewer.get_image_data()

# If you clicked a row in a catalog table, you can fetch that exact row in Python
selected_source = viewer.get_selected_catalog_row()
print(selected_source)
```

## How It Works Under the Hood

For developers: The `FViewer` Python class is built using the **Mixin Pattern**. While the user sees a single, easy-to-use `viewer` object, the source code is heavily modularized. Commands for images (`ImageControlMixin`), regions (`RegionsMixin`), and other plugins are written in separate files. This makes it easy for the community to contribute new Python commands without cluttering a massive central file.
