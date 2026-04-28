# FViewer

**FViewer** is a modern, high-performance, browser-based astronomical FITS file viewer. Designed to replace traditional desktop tools like HEASARC's `fv` and `ds9`/`js9`, it allows you to analyze FITS images and tables entirely client-side without needing a backend server.

Powered by WebAssembly (C++ `cfitsio` and `wcslib`) and React, FViewer processes data in a background Web Worker, ensuring a smooth UI experience.

## ✨ Features

### Image Analysis (DS9 / JS9 Parity)
*   **Image Rendering:** Smooth panning, zooming, flipping (X/Y), and custom-angle rotation.
*   **Dynamic Scaling:** Instant Linear, Log, Square Root, and ASINH stretches.
*   **Colormaps:** Standard astronomical colormaps (Grayscale, Heat, Cool, Plasma).
*   **WCS Coordinates:** Real-time RA/Dec sky coordinate tracking on mouse hover.
*   **Interactive Regions:** Draw, drag, resize, and rotate SVG-based regions (Circles, Boxes, Ellipses, Annuli).
*   **Region I/O:** Save and load regions to standard DS9-style `.reg` text files.

### Table & Data Analysis (FV Parity)
*   **Virtualized Data Grid:** Scroll through 100,000+ row binary tables instantly.
*   **Cell Editing:** Double-click to edit table cells, and save the modified FITS file back to your local disk.
*   **Header Editor:** A searchable modal to view and modify FITS header keywords.
*   **Advanced Plotting:** Built-in `uPlot` engine for lightning-fast graphing:
    *   2D Scatter Plots with independent X and Y error bars.
    *   1D Histograms.
    *   **Region Integration:** Draw a region on an image to instantly generate a histogram of the enclosed pixel intensities in the plotter sidebar.

### Optinal Server that creats an API.
* Its enables interacting with the app from python.
* Allows remote analysis (e.g. running in a remote srver inside jupyterlab)


## 🛠️ Technology Stack
*   **Frontend:** React 18, TypeScript, Vite
*   **Styling:** Bootstrap 5 (CSS & Icons), custom IDE-style dark theme
*   **Plotting:** `uPlot` (Ultra-fast, lightweight canvas charting)
*   **Backend / Processing:** Web Worker running a custom WebAssembly (`.wasm`) compilation of `cfitsio` and `wcslib`.

## 🚀 Getting Started

### Deployment
See it in action in: https://heasarcdev.gsfc.nasa.gov/azoghbi/fviewer/

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed.

### Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### Local Development
Spin up the Vite development server:
```bash
npm run dev
```
Open your browser to the provided `localhost` URL. You can drag and drop FITS files or click "File -> Open Local File" to begin.

## 📦 Building for Production

FViewer is a **100% static application**. It does not require a database or a Node.js/Python server to run in production.

1. Build the optimized static files:
   ```bash
   npm run build
   ```
2. The output will be generated in the `dist/` directory.
3. Deploy the contents of the `dist/` folder to any static web host (GitHub Pages, GitLab Pages, AWS S3, Netlify, Apache, Nginx, etc.).


## 📁 Project Structure
*   `src/components/` - React UI components (`FitsImage`, `VirtualTable`, `FitsPlot`, `FitsHeaderModal`).
*   `src/hooks/` - Contains `useFits.ts` which manages the asynchronous bridge to the Web Worker.
*   `src/utils/` - Mathematical helpers for image stretching and procedural colormaps.
*   `src/fits.worker.ts` - The Web Worker script that loads the WASM module and safely performs heavy FITS file manipulation off the main UI thread.
*   `src/theme.css` - Custom CSS overrides to create the compact, dark "IDE" aesthetic.

## 📄 License
Pending
