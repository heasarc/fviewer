# Regions and Catalogs

When looking at astronomical images, you rarely just want to stare at the pixels. You usually need to mark specific objects, measure areas, or cross-reference what you see with known databases. FViewer handles this using **Regions** and **Catalog Overlays**.

## Working with Regions

Regions are shapes you can draw directly over your FITS image to highlight areas of interest, measure backgrounds, or define extraction boundaries. If you have used `ds9` in the past, FViewer’s region system will feel familiar.

### Drawing and Editing
You can access the region tools from the **Region Toolbar** or the top menubar. 
*   **Shapes:** You can draw Circles, Boxes, Ellipses, and Annuli (rings). 
*   **Interacting:** Once a shape is drawn, you can click and drag it around the image. You can also use the drag handles to resize or rotate the shape precisely.
*   **Pan vs. Draw Mode:** By default, clicking and dragging on the image pans your view. To draw, simply select a shape from the toolbar. Once you are done drawing, FViewer automatically switches back to Pan mode so you don't accidentally draw shapes when trying to navigate.

### Saving and Loading
FViewer is fully compatible with standard **DS9 Region Files (`.reg`)**. 
*   You can save your drawn regions to a text file to share with collaborators or use in other analysis pipelines.
*   You can load existing `.reg` files into FViewer. FViewer understands complex coordinate systems (like converting RA/Dec to image pixels on the fly) and will preserve your specific colors, line styles, and background tags.

## Catalogs and TAP Queries

While regions let you manually mark objects, Catalogs let you overlay thousands of known sources from remote databases directly onto your image. 

FViewer includes a powerful **TAP (Table Access Protocol)** client. This allows you to query massive remote astronomical archives—like HEASARC, Chandra, or XMM-Newton—from inside the viewer.

### Searching Archives
1. Open the **Catalogs** menu.
2. You can perform a **Context-Aware Spatial Query**: If you are currently viewing an image with built-in coordinates (WCS), FViewer can automatically search a remote database for any known sources that fall within the exact footprint of your current screen.
4. If a region is selected from the image when making the query, the catalog will be searched for soruces within that region.
4. **Manual ADQL:** For advanced users, you can write custom ADQL (Astronomical Data Query Language) queries to filter exactly what you want to download.

### Interactive Overlays
When you load a catalog (whether from a remote TAP query or by opening a local `VOTable` file):
*   FViewer automatically plots the catalog sources as circular markers directly over your FITS image.
*   The center workspace splits in half, showing the image on one side and the catalog data in a spreadsheet on the other.

### Bidirectional Linking
The catalog markers on the image and the rows in the data table are perfectly linked:
*   **Click a marker on the image**, and the data table will instantly auto-scroll to the exact row for that source, highlighting it in green so you can read its properties.
*   **Click a row in the data table**, and the image will automatically snap and center onto that specific source. 

Because FViewer uses an optimized, zero-dependency data grid, this linking happens instantly, even if the catalog contains hundreds of thousands of sources.
