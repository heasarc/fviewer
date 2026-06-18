
I am developing a modern, browser-based astronomical FITS file viewer called **FViewer**. The goal is to replace traditional desktop tools like HEASARC's `fv` and `ds9`/`js9`. 

We have successfully transitioned from a static client-side MVP to a hybrid Python/React application with a bidirectional Jupyter-compatible API. Here is the complete context of the project architecture and current state:

### Tech Stack & Philosophy
* **Frontend:** React 18, TypeScript, Vite. 
* **Styling:** Bootstrap 5 (CSS & Icons only), with a custom `theme.css` file providing a dark, compact "Desktop IDE" aesthetic. (using CSS variables like `--fv-bg`, `--fv-panel`, and the Lato font). We strictly minimize dependencies.
* **Plotting:** `uPlot` (chosen for ultra-fast canvas rendering).
* **Processing Backend:** 
  * Custom WebAssembly (`cfitsio`/`wcslib`) inside a background Web Worker (`fits.worker.ts`).  The worker pases TypedArrays back to the React hooks. It also exposes asynchronous pixToWorld and worldToPix functions for WCS coordinate transforms.
  * Rust WASM (`cds-votable-rust`) inside a parallel Web Worker (`vo.worker.ts`) for high-performance remote catalog parsing.
* **Server/Backend:** `FastAPI` (Python) serving the Vite build, securely streaming local files, managing WebSockets, and proxying HTTP requests to bypass CORS.
* **Python Client:** A synchronous Python class (`FViewer` in `api.py`) allowing users to control the UI and extract data from Jupyter notebooks.
* **Packaging:** `hatchling` via `pyproject.toml`. A custom script `sync-version.py` is called along with `npm run dev` or `npm run build` hooks that automatically syncs the Python version to `package.json`.


#### 1. Frontend Plugin Architecture (React/TS)
The React frontend avoids monolithic components (like a giant `App.tsx` or a massive `switch` statement for WebSockets). It relies on three core pillars:
*   **`FViewerContext` (State):** A global React Context containing all lifted state and routing flags (`activeDataType: 'fits' | 'votable'`, `activeHdu`, `imageData`, `regions`, `selectedCatalogRow`), plus the instances of both Web Workers (`fitsWorker` and `voWorker`). UI components dynamically query the correct worker based on the `activeDataType`. Plugins access this via the `useCore()` hook.
*   **`CommandRegistry` (WebSocket Routing):** A decoupled registry. Instead of a hardcoded switch statement, plugins register their own Python API listeners: `commandRegistry.register('set_colormap', handler)`.
*   **`PluginManager` (UI Extension Slots):** `App.tsx` acts only as a structural layout shell containing `<ExtensionSlot name="..." />` components. Plugins inject their UI (buttons, menus, sidebars) directly into these slots (e.g., `menubar:edit`, `fitsimage:toolbar`, `workspace:right`).

*Existing Core Plugins:* `PlotterPlugin`, `HDUExplorerPlugin`, `HeaderEditorPlugin`, `ServerFilePlugin`, `ImageControlPlugin`, `RegionToolbarPlugin`, `TransformPlugin`, `DataCubePlugin`, `ZoomPlugin`, and `TAPQueryPlugin` (Adds a "Catalogs" menu with manual ADQL search and context-aware spatial overlay queries like HEASARC Chandra/XMM).

#### 2. Python Client Architecture (`api.py`)
The Python API uses the **Mixin Pattern** to maintain a flat, Jupyter-friendly namespace while keeping the source code perfectly modular and Flake8-compliant.
*   **Core (`api.py`):** Handles WebSocket initialization, HTTP POST routing (`_send`), and Jupyter token auth.
*   **Mixins (`fviewer/plugins/`):** Contributors write Mixin classes (e.g., `ImageControlMixin`, `RegionsMixin`) containing their specific Python commands.
*   **Composition:** `class FViewer(ImageControlMixin, RegionsMixin):`. Users instantiate `viewer = FViewer()`. Commands (e.g., `load_file`, `add_region`, `get_colormap`) are sent via HTTP POST to the FastAPI server.

#### 3. FastAPI Backend Architecture (`server.py`)
The FastAPI server is divided using `APIRouter`.
*   **Core Server:** Handles the `/ws` WebSocket endpoint, CORS regex matching, JWT Authentication, and static file mounting. Uses an `asyncio.Future` pattern (`send_and_wait`) to bridge synchronous Python requests to asynchronous React WebSocket replies.
*  **Server Plugins (`fviewer/server_plugins/`):** Specific backend logic extracted into routers, such as `file_system.py` (secure local directory browsing) and `tap_proxy.py` (uses a synchronous `requests` call running in a background thread to safely tunnel TAP queries and bypass browser CORS without blocking async WebSockets).

#### Core Frontend Components (The "Shell")
1.  **`App.tsx`:** A 100vh flexbox shell. Renders:
    - **Top Menubar:** Contains dropdowns (File, Edit, View, Catalogs) and right-aligned toggles fpr the Plotter.
    - **Left Sidebar:** A scrollable list of HDUs.
    - **Center Workspace:** Dynamically renders `<FitsImage />`, `<VirtualTable />`, or a responsive side-by-side split screen (`flex-row`) if both an Image and a Catalog are actively loaded.
    - **Right Sidebar:** Collapsible dynamic Plotter UI.
2.  **`<FitsImage />`:** The core rendering engine. Paints TypedArrays to an HTML5 Canvas using JS colormap LUTs. Handles CSS-based panning/zooming. Exposes its own internal extension slots for its toolbar. The `DataCubePlugin` injects a dropdown with UI sliders to navigate multidimentional data planes.
    * Renders FITS pixels to a bottom `<canvas>` using custom stretches (Linear, Log, Sqrt, ASINH) and procedural colormaps (Gray, Heat, Cool, Plasma).
    * Panning, zooming, flipping, and rotating are handled via hardware-accelerated CSS `transform` on the canvas wrapper.
    * Real-time WCS (RA/Dec) tracking is displayed in a bottom status bar.
    * Renders an SVG overlay for Region drawing/dragging and dynamic Catalog Overlay points (`<circle>`). Catalog points are bidirectionally linked to the VirtualTable; clicking a circle updates the `selectedCatalogRow` state.
3.  **`<VirtualTable />`:** A custom, zero-dependency lazy-loading virtualized grid for massive binary tables (100,000+ rows). 
    - Routes missing data requests (`onFetchData`) to either the FITS or VOTable worker.
    - Supports `isReadOnly` mode (disabling edits for catalogs).
    - Implements bidirectional linking (`selectedRow` prop): instantly auto-scrolls to center the viewport on the selected row and highlights it with a green border/tint when clicked on the `<FitsImage />`.
    - Vector & VLA Support: Cells containing multi-dimensional binary arrays (Fixed Vectors, Variable-Length Arrays, and Bit Arrays) render an interactive button instead of text. Clicking it opens <VectorModal />, a high-performance, purely DOM-virtualized popup that allows instant scrolling through massive arrays without freezing the UI. Users can double-click specific array elements in the modal to edit them.
4.  **`<FitsPlot />`:** 2D scatter and 1D histograms using `uPlot`. Dynamically fetches full columns via zero-copy from the active worker (`fits` or `vo`). Supports random subsetting via Reservoir Sampling.
5. **State Management**: Manages two separate data pools to prevent UI freezing:
    - tableData: Holds tiny 100-row chunks for the VirtualTable.
    - fullPlotData: Holds full-length columns for the Plotter (fetched eagerly via Transferable Objects only when the plotter panel is open, tracked via fetchedPlotColumns ref to prevent request spam).
6. **Web Workers:**
    - **`fits.worker.ts`:** Wraps C++ WASM (`cfitsio`). Handles `READ_TABLE_CHUNK` and `READ_COLUMN` by returning zero-copy Transferable Objects (ArrayBuffers) to the main thread for 0ms transfer times. Extracts multidimensional data cubes via bindings.
    - **`vo.worker.ts`:** Wraps Rust WASM (`cds-votable-rust`). Parses ADQL XML payloads. Transposes the heavily nested Serde-generated JSON into flat columnar `TypedArrays` and actively garbage collects the JSON objects to save RAM. Perfectly mimics the `Transferable` message payload contract of the FITS worker so the React frontend requires zero code changes to display VOTables.

7. **Regions:**
   * `useRegions.ts` (Hook): Manages local drawing modes (pan, circle, box, ellipse, annulus), drafts, and the mathematical calculations for dragging, resizing, and rotating shapes on the canvas.
   * `RegionOverlay.tsx`: A stateless SVG component overlay sitting on top of the canvas. Renders shapes, hit-detection areas, and interactive drag handles. Visually distinguishes background regions with dashed outlines.
   * `regionUtils.ts` (Parser/Serializer): compliant with standard DS9 region format. Handles async conversion of WCS coordinates (fk5 RA/Dec) to/from pixel coordinates (image) using useFits methods. Safely parses sexagesimal formats and unit suffixes, and preserves properties like color and # background.
   * Regions can be saved/loaded to DS9-style `.reg` text files.

#### Testing Strategy
*   **Frontend & WASM (Vitest + Playwright):** Runs in "Browser Mode" to natively test Web Workers and WASM initializations. Uses a custom `PluginTestWrapper` that creates a mock `FViewerContext` with dummy workers (`fitsWorker`, `voWorker`) and data states to test isolated plugin rendering.
*   **FastAPI Backend (Pytest + HTTPX):** Validates security (e.g., path traversal prevention). Asynchronous WebSocket routing and `send_and_wait` Futures are tested using pure `asyncio` to avoid FastAPI `TestClient` deadlocks.
*   **Python Client (Pytest + Responses):** Mocks REST calls to validate JSON payload formatting, dynamic session connection logic, and authentication token injection. Modular tests (`test_plugin_regions.py`) mocking the REST/WebSocket responses to ensure correct JSON payloads are generated.
*   **End-to-End (Pytest-Playwright):** Starts a live `uvicorn` server and headless Chromium browser. Validates the complete bidirectional loop: Python API sends a command -> WebSocket routes it -> React/WASM processes it -> Playwright asserts the actual DOM/canvas updates.
*   **React Plugins (`Vitest + Testing Library`):** We use a custom `PluginTestWrapper` that creates a mock `FViewerContext`. This allows us to mount and test individual plugins (UI rendering and WebSocket command execution) in total isolation without mounting the heavy Canvas/App components.


#### Security Boundaries
*   **Filesystem Jailing:** Endpoints reading local disk (`/api/file`, `/api/fs/list`) use `pathlib.Path.is_relative_to()` to strictly confine access to the workspace root, blocking path traversal attacks.
*   **API Authentication:** Control endpoints (like `/api/command`) require the `JUPYTERHUB_API_TOKEN`, preventing unauthorized local network users from hijacking the UI.
*   **CORS & WebSockets:** Regex-based `CORSMiddleware` safely supports dynamic Jupyter ports. WebSockets explicitly validate `Origin` against `Host` headers to prevent Cross-Site WebSocket Hijacking (CSWSH).
*   **Payload Sanitization:** The React command handler strictly validates all incoming WebSocket payloads (types, coordinate bounds, color hexes) before mutating state to prevent XSS or UI crashes.
*   **Jupyter Integration:** The TypeScript lab extension uses a custom Lumino Widget to embed FViewer in a clean `<iframe>`, avoiding conflicting `sandbox` attributes and resolving browser security warnings.


### Current Task
Understanding this architecture, I would like to *** Add what is needed ***.

Do not make any assumption about the code. I can provide snippets when needed. If not sure ask. When making code suggestions, ensure the current behavior is maintained unless we are explicitly changing it. Do not rush into suggesting code, let's make sure you get the full context and I understand the changes first.