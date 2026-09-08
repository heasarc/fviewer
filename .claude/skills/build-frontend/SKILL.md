---
name: build-frontend
description: Build the FViewer React frontend, sync Python/npm versions, and verify the static assets are ready to serve
---

# Build Frontend Skill

Rebuilds the React/TypeScript frontend and deploys it into the Python package's static directory. Required after any change to files under `frontend/src/`.

## Prerequisites

- Node.js and npm installed
- Frontend dependencies installed: `cd frontend && npm install`
- Python package installed in dev mode: `pip install -e .`

## Build Steps

### 1. Install dependencies (if needed)

```bash
cd frontend
npm install
```

Only needed if `package.json` changed or `node_modules/` is missing.

### 2. Build the frontend

```bash
cd frontend
npm run build
```

This runs two steps automatically (defined in `package.json`):
1. **`python sync-version.py`** — Reads `__version__` from `fviewer/__init__.py` and writes it into `frontend/package.json` and `frontend/src/App.tsx` to keep versions in sync.
2. **`tsc -b && vite build`** — Type-checks TypeScript, then bundles with Vite.

**Output directory:** `fviewer/static/` (configured in `frontend/vite.config.ts` as `outDir: '../fviewer/static'`).

Rollup is configured to produce stable filenames (no content hashes):
- `assets/index.js`
- `assets/index.css`
- `assets/vendor.js` (chunk)

### 3. Verify the build

After building, confirm the static assets exist:

```bash
ls -la fviewer/static/index.html fviewer/static/assets/index.js fviewer/static/assets/index.css
```

Expected: all three files present and recently modified.

## Version Sync Details

The version is the single source of truth in `fviewer/__init__.py`:

```
fviewer/__init__.py  →  __version__ = "X.Y.Z"
         ↓ (sync-version.py)
frontend/package.json  →  "version": "X.Y.Z"
frontend/src/App.tsx   →  version string in the UI
```

**To bump the version:** Edit `fviewer/__init__.py` only. The next `npm run build` or `npm run dev` will propagate it.

## Development Mode

For iterative frontend development (hot reload, no full build needed):

```bash
cd frontend
npm run dev
```

This also runs `sync-version.py` first, then starts the Vite dev server with HMR. The Python backend is **not** started — you need to run `fviewer` separately if you need the API.

## Lint

```bash
cd frontend
npm run lint
```

Uses ESLint with TypeScript and React hooks plugins (configured in the project).

## Full Rebuild from Clean State

```bash
cd frontend
rm -rf node_modules
npm install
npm run build
cd ..

# Verify
ls fviewer/static/index.html
python -c "from fviewer import __version__; print(__version__)"
```

## Common Issues

### "Cannot find module 'wasm-cfitsio'" or "Cannot find module 'votable-wasm'"
These are local file dependencies (see `package.json` `file:` references). Ensure the sibling repos are built:
- `wasm-cfitsio` at `../../wasm-cfitsio/wasm-cfitsio-0.0.9.tgz`
- `cds-votable-rust` at `../../cds-votable-rust/crates/wasm/pkg`

### "sync-version.py failed"
Ensure `fviewer/__init__.py` contains a valid `__version__ = "X.Y.Z"` string.

### Build succeeds but server shows old UI
The browser may cache old assets. Hard-refresh (Cmd+Shift+R) or clear the browser cache. Since filenames are stable (no hashes), the browser may serve stale versions.

### TypeScript errors during build
`tsc -b` runs before Vite. Fix type errors first — the build won't proceed until TypeScript is clean.

### "emptyOutDir: true" warning
This is expected. Vite clears `fviewer/static/` before writing new files to ensure no stale assets remain.
