import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


app = FastAPI(title="FViewer API")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_to_client(self, client_id: str, message: dict):
        if ws := self.active_connections.get(client_id):
            await ws.send_json(message)

    async def broadcast(self, message: dict):
        for ws in self.active_connections.values():
            await ws.send_json(message)


manager = ConnectionManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)
    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id)


@app.post("/api/command")
async def receive_command(command: dict, client_id: str = None):
    """If client_id is provided, send to that specific viewer.
    Otherwise, broadcast."""
    if client_id:
        await manager.send_to_client(client_id, command)
    else:
        await manager.broadcast(command)
    return {
        "status": "success",
        "command": command,
        "client_id": client_id or "all"
    }


@app.get("/api/clients")
def get_clients():
    """Return a list of connected client IDs."""
    return {"clients": list(manager.active_connections.keys())}


@app.get("/api/file")
async def serve_local_file(path: str):
    """Securely serve a local file from the Python backend to
    the React frontend."""
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    # FileResponse automatically handles chunked streaming for large files
    return FileResponse(path)


@app.get("/api/health")
def health_check():
    return {"status": 'OK'}


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
