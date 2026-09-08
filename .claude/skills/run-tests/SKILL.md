---
name: run-tests
description: Run FViewer test suites — Python backend (pytest), frontend (vitest), or end-to-end (playwright) — with coverage
---

# Run Tests Skill

FViewer has three independent test suites. This skill runs the correct one(s) based on what was changed, or all of them on request.

## Test Suites

### 1. Python Backend Tests (pytest)

Covers: `fviewer/` — server, API client, CLI, server plugins, Python mixins.

```bash
# From the repo root:
pytest
```

This automatically uses the config in `pyproject.toml`:
- Test path: `tests/`
- Coverage: `--cov=fviewer --cov-report=term-missing --cov-report=html:coverage_html_report`
- Async mode: `auto` (pytest-asyncio)

**Run a single test file:**
```bash
pytest tests/test_server.py
```

**Run a single test function:**
```bash
pytest tests/test_server.py::test_function_name
```

**Expected:** 100% coverage on `fviewer/`. If coverage drops, investigate which lines are uncovered.

### 2. Frontend Tests (vitest)

Covers: `frontend/src/` — React plugins, Web Worker core logic, hooks, utilities.

```bash
cd frontend
npx vitest run
```

**With coverage:**
```bash
cd frontend
npx vitest run --coverage
```

Config is in `frontend/vite.config.ts` under `test`:
- Runs in browser mode (Playwright/Chromium, headless)
- Test files: `frontend/tests/**/*.test.{ts,tsx}`
- Coverage provider: V8, covers `src/**/*.{ts,tsx}`, excludes `.d.ts`, `.worker.ts`, and `tests/`

**Run a single test file:**
```bash
cd frontend
npx vitest run tests/fits.core.test.ts
```

**Important:** Vitest browser mode requires Playwright browsers installed. If you get a browser error:
```bash
cd frontend
npx playwright install chromium
```

### 3. End-to-End Tests (pytest-playwright)

Covers: Full bidirectional loop — Python API → WebSocket → React/WASM → DOM assertion.

```bash
pytest tests_e2e/
```

**Prerequisites:**
- The server is started automatically by the e2e test fixtures
- Playwright browsers must be installed: `playwright install chromium`
- The frontend must be built: `cd frontend && npm run build`

**Run a single e2e test:**
```bash
pytest tests_e2e/test_full_loop.py::test_function_name
```

## Deciding Which Suite to Run

| Files changed | Suite to run |
|---|---|
| `fviewer/*.py`, `fviewer/plugins/*.py`, `fviewer/server_plugins/*.py` | Python backend (`pytest`) |
| `frontend/src/**/*.{ts,tsx}` | Frontend (`cd frontend && npx vitest run`) |
| `frontend/src/**/*.worker.ts`, `frontend/src/workers/*.core.ts` | Frontend (workers tested via core classes) |
| Changes spanning both Python and frontend | Both suites |
| UI behavior, integration, or user-visible workflows | E2E (`pytest tests_e2e/`) |
| Not sure / pre-release check | All three |

## Running All Suites

```bash
# 1. Python backend
pytest

# 2. Frontend
cd frontend && npx vitest run --coverage && cd ..

# 3. E2E (requires built frontend)
pytest tests_e2e/
```

## Interpreting Results

- **pytest** prints coverage table to terminal. HTML report at `coverage_html_report/index.html`.
- **vitest** prints coverage to terminal. HTML report at `frontend/coverage/index.html` (when `--coverage` is used).
- **E2E failures** usually indicate a regression in the Python→WebSocket→React chain. Check server logs in the test output.

## Common Issues

### "No module named 'fviewer'"
Install the package in dev mode: `pip install -e .`

### Vitest times out or hangs
Browser mode can be slow on first run. Ensure Playwright chromium is installed: `cd frontend && npx playwright install chromium`

### E2E tests fail with "connection refused"
The frontend static assets may not be built. Run: `cd frontend && npm run build`

### Coverage dropped
Compare the `term-missing` output to identify uncovered lines. New code paths need corresponding tests.
