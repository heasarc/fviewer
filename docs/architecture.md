
# Architecture & Under the Hood

FViewer is built to handle massive datasets without freezing your browser, while maintaining a clean, modular codebase. It achieves this by combining a modern JavaScript frontend (React) with high-performance WebAssembly (WASM) and a lightweight Python backend (FastAPI).

If you are looking to contribute to FViewer or write your own plugins, understanding this architecture is the best place to start.

## The Big Picture: How Python Talks to the Browser

One of FViewer's most unique features is its synchronous Python API. But how does a standard Python script instantly control a web browser?

1.  **The Python Call:** You call `viewer.set_colormap('plasma')` in Python.
2.  **HTTP to FastAPI:** The Python client packages this as a JSON command and sends it via an HTTP POST request to the local FastAPI server.
3.  **The Async Bridge (`send_and_wait`):** The FastAPI server receives the HTTP request. It forwards the command over a **WebSocket** directly to the React frontend. Crucially, FastAPI uses an `asyncio.Future` to "pause" the HTTP request until it gets a reply.
4.  **React & WebAssembly:** The frontend receives the WebSocket command, parses it via the `CommandRegistry`, and updates the UI (or asks the WASM workers to crunch numbers).
5.  **The Reply:** The browser sends a WebSocket message back to FastAPI saying "Done." FastAPI resolves the Future and returns the HTTP response back to your Python script.

To the user, it looks like a standard Python function call. Under the hood, it is a full bidirectional loop.

## Frontend Architecture (React & WebAssembly)

The frontend avoids the trap of a massive, tangled React app. It relies on three core pillars: performance (Workers), state (Context), and modularity (Plugins).

### 1. Web Workers & WebAssembly
Processing gigabytes of FITS data or parsing complex XML VOTables on the main JavaScript thread would instantly freeze the browser UI. Instead, FViewer uses background Web Workers:
*   **`fits.worker.ts`:** Wraps C++ libraries (`cfitsio` and `wcslib`) via WASM. It handles all FITS reading, coordinate math, and data extraction.
*   **`vo.worker.ts`:** Wraps Rust (`cds-votable-rust`) via WASM to parse complex ADQL and VOTable XML payloads at lightning speed.

When these workers finish processing data (like extracting a table column or image chunk), they use **Transferable Objects** to pass the binary data arrays back to React with zero-copy overhead (0ms transfer time). 

### 2. Global State (`FViewerContext`)
FViewer avoids heavy state management libraries like Redux. Instead, it uses a single React Context (`FViewerContext`) that acts as the central nervous system. It holds the active data type, currently selected HDU, drawn regions, and the instances of the Web Workers. Any component can access this state using a simple `useCore()` hook.

### 3. The Plugin System & Extension Slots
The main `App.tsx` file is incredibly bare. It acts only as a structural layout shell. Instead of hardcoding buttons and menus, the shell contains empty placeholders called `<ExtensionSlot />` components.

Every feature in FViewer (the Header Editor, the Plotter, the Region Toolbar) is actually an independent plugin. When FViewer loads, plugins inject their specific UI elements into these slots (e.g., `menubar:edit`, `fitsimage:toolbar`). 

## Backend Architecture (Python & FastAPI)

The backend is equally modular, utilizing FastAPI for routing and a clever "Mixin Pattern" for the Python client.

### FastAPI Server Plugins
The FastAPI server is divided using `APIRouter`. Base routes handle the WebSocket and static files, while specific logic is extracted into separate files. For example, `file_system.py` securely handles local directory browsing (strictly confined to avoid path traversal), and `tap_proxy.py` safely tunnels external catalog queries to bypass browser CORS restrictions.

### Python API Mixins
To keep the Python API "flat" and easy to use (e.g., `viewer.load_file()`), while keeping the actual source code perfectly organized, FViewer uses **Mixins**.

If you write a new plugin for plotting, you don't edit a massive `api.py` file. Instead, you create a `PlottingMixin` class containing your specific Python commands. The main `FViewer` class simply inherits from all these smaller mixins:

```python
class FViewer(ImageControlMixin, RegionsMixin, PlottingMixin, ...):
    pass
```

## Adding Your Own Feature (The Developer Workflow)

Because of this decoupled architecture, adding a new feature is straightforward and won't break existing code:

1.  **Write the React Component:** Create your UI (e.g., a new analysis tool).
2.  **Register the Command:** Tell the frontend's `CommandRegistry` to listen for a specific WebSocket command to trigger your tool.
3.  **Inject it:** Tell the `PluginManager` which `<ExtensionSlot />` should display your tool's button.
4.  **Write the Python Mixin:** Create a small Python class with a function that sends your new JSON command via the `_send()` method. Add it to the main `FViewer` class.

All testing is set up to handle this modularity. You can test your React plugin in total isolation using the `PluginTestWrapper` (via Vitest), and use Pytest-Playwright to test the full loop from a Python command down to the browser's HTML canvas.
