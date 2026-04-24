import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="FViewer API")

# Calculate the path to the compiled Vite output
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


@app.get("/api/health")
def health_check():
    return {"status": "OK"}


# We will mount the static files last as a catch-all
if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    @app.get("/")
    def index():
        return {
            "error":
            ("Frontend not built. Run 'npm run build' in the "
             "frontend directory.")
        }
