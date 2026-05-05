
I am developing a modern, browser-based astronomical FITS file viewer called **FViewer**. The goal is to replace traditional desktop tools like HEASARC's `fv` and `ds9`/`js9`. 

We have successfully transitioned from a static client-side MVP to a hybrid Python/React application with a bidirectional Jupyter-compatible API. Here is the complete context of the project architecture and current state:

### Tech Stack & Philosophy
* **Frontend:** React 18, TypeScript, Vite. 
* **Styling:** Bootstrap 5 (CSS & Icons only), with a custom `theme.css` file providing a dark, compact "Desktop IDE" aesthetic. (using CSS variables like `--fv-bg`, `--fv-panel`, and the Lato font). We strictly minimize dependencies.
* **Plotting:** `uPlot` (chosen for ultra-fast canvas rendering).
* **Processing Backend:** Custom WebAssembly (`cfitsio`/`wcslib`) inside a background Web Worker (`useFits.ts`) to prevent UI freezing. The worker pases TypedArrays back to the React hooks.
* **Server/Backend:** `FastAPI` (Python) serving the Vite build, securely streaming local FITS files, and managing WebSocket connections.
* **Python Client:** A synchronous Python class (`FViewer` in `api.py`) allowing users to control the UI and extract data from Jupyter notebooks.
* **Packaging:** `hatchling` via `pyproject.toml` with a custom `hatch_build.py` hook that automatically syncs the Python version to `package.json`, runs `npm build`, and bundles the frontend inside the `.whl`.


### Backend & API Architecture
1. **The Python Client (`api.py`):** Users instantiate `viewer = FViewer()`. Commands (e.g., `load_file`, `add_region`, `get_colormap`) are sent via HTTP POST to the FastAPI server.
2. **FastAPI Server (`server.py`):** Acts as the middleman. It uses an `asyncio.Future` pattern (`send_and_wait`) to forward the command over WebSocket to the React frontend, wait for a success/data acknowledgment, and return the result to the Python user.
3. **React WebSocket Hook (`useWebSocket.ts`):** Connects to the server and listens for commands. It dynamically passes a `sendReply` function to the command handler.
4. **React Command Handler (`useCommandHandler.ts`):** A massive `switch` statement that intercepts API commands, interacts with React state or the `useFits` worker, and replies with data or a status acknowledgment back through the WebSocket.

### Core Frontend Components
1. **`App.tsx` (Layout & State):** 100vh flexbox layout:
    - **Top Menubar:** Contains dropdowns (File, Edit, View) and a toggle for the Plotter.
    - **Left Sidebar:** A scrollable list of HDUs in the loaded FITS file.
    - **Center Workspace:** Displays either `<FitsImage />` or `<VirtualTable />` depending on the selected HDU.
    - **Right Sidebar (Collapsible):** Contains a dynamic Plotter UI.
    - `App.tsx` holds lifted state (like `colormap`, `stretch`, `regions`) so both the UI components and the `useCommandHandler` can read/update them.
    - **State Management**: Manages two separate data pools to prevent UI freezing:
        - tableData: Holds tiny 100-row chunks for the VirtualTable.
        - fullPlotData: Holds full-length columns for the Plotter (fetched eagerly via Transferable Objects only when the plotter panel is open, tracked via fetchedPlotColumns ref to prevent request spam).
2. ** Web Worker (`fits.worker.ts`):**
    - Implements a JS `tableCache` to isolate data from the WASM heap (`typed_memory_view`).
    - Uses `.slice()` to clone ArrayBuffers instantly, protecting against C++ memory corruption (`clearDataVectors()`).
    - Exposes two endpoints: `READ_TABLE_CHUNK` (for VirtualTable) and `READ_COLUMN` (for Plotter). Both return data using zero-copy Transferable Objects for 0ms main-thread transfer.
3. **`FitsImage.tsx` (Image Viewer):**
   * Renders FITS pixels to a bottom `<canvas>` using custom stretches (Linear, Log, Sqrt, ASINH) and procedural colormaps (Gray, Heat, Cool, Plasma).
   * Panning, zooming, flipping, and rotating are handled via hardware-accelerated CSS `transform` on the canvas wrapper.
   * **Regions:** An `<svg>` overlay sits on top of the image canvas. Users can draw, drag, resize, and rotate Circles, Boxes, Ellipses, and Annuli. Hit detection is handled natively by SVG `onPointerDown` events.
   * Real-time WCS (RA/Dec) tracking is displayed in a bottom status bar.
   * Extracts pixels inside a drawn region and sends them to the Right Sidebar to instantly plot a 1D Histogram.
   * Regions can be saved/loaded to DS9-style `.reg` text files.
   * Renders FITS pixels to a bottom `<canvas>` using custom stretches and procedural colormaps.
4. **`VirtualTable.tsx` (Table Viewer):** 
    - A custom, zero-dependency virtualized grid for 100,000+ row binary tables with double-click editing.
    - Uses an Intersection-Observer style lazy-loading approach (onFetchData). As the user scrolls, it debounces requests to the worker for missing 100-row chunks, ensuring infinite scrolling uses minimal RAM.
5. **`FitsPlot.tsx`:** 
    - 2D Scatter Plots and 1D Histograms linked to drawn regions.
    - Uses flat, typed index arrays (Uint32Array) for in-place sorting and preparation to avoid Garbage Collection crashes on massive datasets.
    - Accepts pointSize, pointColor, and supports Data Subsetting (subsetMode: 'all', 'range', 'random'). Random subsetting uses Reservoir Sampling.
6. **`FitsHeaderModal.tsx`:** Searchable FITS header card viewer/editor.
7. **`ServerFileModal`**: When a backend server is running, this is used to open a file brower on the server side.

### Current Task
Understanding this architecture, I would like to do the following:
**[INSERT YOUR NEXT GOAL HERE - e.g., Add commands to extract 2D image pixel arrays back to Python, or Implement multi-tab session management]**