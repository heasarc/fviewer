# Copyright 2026, University of Maryland, All Rights Reserved

import os
import asyncio
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# If running standalone, this defaults to "" (empty string)
# If running in Jupyter, this becomes "/fviewer"
root_path = os.getenv("FVIEWER_ROOT_PATH", "")

app = FastAPI(title="FViewer API", root_path=root_path)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.pending_requests: dict[str, asyncio.Future] = {}

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

    async def send_and_wait(self, client_id: str, message: dict, timeout=5.0):
        """Sends a message and waits for the frontend to reply."""
        if client_id not in self.active_connections:
            return {"error": "Client not connected"}

        msg_id = str(uuid.uuid4())
        message["message_id"] = msg_id

        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.pending_requests[msg_id] = future

        await self.active_connections[client_id].send_json(message)

        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            return {"error": "Timeout waiting for frontend"}
        finally:
            self.pending_requests.pop(msg_id, None)


manager = ConnectionManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(client_id, websocket)
    try:
        while True:
            # Listen for replies from React
            data = await websocket.receive_json()
            msg_id = data.get("message_id")
            if msg_id and msg_id in manager.pending_requests:
                manager.pending_requests[msg_id].set_result(data)
    except WebSocketDisconnect:
        manager.disconnect(client_id)


@app.post("/api/command")
async def receive_command(command: dict, client_id: str):
    # ALL commands wait for an acknowledgment from React
    result = await manager.send_and_wait(client_id, command)

    # If React (or the timeout) returned an error, return a 400 Bad Request
    if "error" in result:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["error"])

    return result


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


@app.get("/api/fs/list")
def list_directory(path: str = "."):
    """Returns the contents of a directory on the server."""
    abs_path = os.path.abspath(path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Directory not found")

    EXTENSIONS = ['.fits', '.fit', '.arf', '.rmf', '.rsp', '.pha']
    EXTENSIONS = tuple(
        f'{ex}{extra}' for ex in EXTENSIONS for extra in ['', '.gz'])

    items = []
    try:
        # Add a "Go Up" option if not at the root
        parent_dir = os.path.dirname(abs_path)
        if parent_dir != abs_path:
            items.append({"name": "..", "path": parent_dir, "is_dir": True})

        for entry in os.scandir(abs_path):
            # Optional: Hide hidden files
            if entry.name.startswith('.') and entry.name != '..':
                continue

            is_dir = entry.is_dir()
            # If it's a file, only show FITS files
            # (optional, customize as needed)
            if not is_dir and not entry.name.lower().endswith(
                    EXTENSIONS):
                continue

            items.append({
                "name": entry.name,
                "path": entry.path,
                "is_dir": is_dir
            })

        # Sort: Directories first, then alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return {"current_path": abs_path, "items": items}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")


@app.get("/api/health")
def health_check():
    return {"status": 'OK'}


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
