# Copyright 2026, University of Maryland, All Rights Reserved

import os
import re
from pathlib import Path
import asyncio
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi import Header, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware


# If running standalone, this defaults to "" (empty string)
# If running in Jupyter, this becomes "/fviewer"
ROOT_PATH = os.getenv("FVIEWER_ROOT_PATH", "")

# worksapce root folder so the server browser does not go wondering
WORKSPACE_ROOT = Path(os.getenv("FVIEWER_WORKSPACE", Path.cwd())).resolve()


app = FastAPI(title="FViewer API", root_path=ROOT_PATH)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


# Define the URLs that are allowed to talk to this API
ORIGINS = [
    os.getenv("FVIEWER_ORIGIN", "")
]
# Regex to allow ANY port on localhost or 127.0.0.1
# Matches: http://localhost:8123, http://127.0.0.1:40593, etc.
LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_secure_path(user_path: str) -> Path:
    """Validates that the requested path is within the WORKSPACE_ROOT."""
    # Combine the root with the user input and resolve() it.
    # resolve() evaluates all symlinks and '..' up-level references to an absolute path.
    target_path = (WORKSPACE_ROOT / user_path).resolve()
    
    # Ensure the resolved target path is strictly inside the WORKSPACE_ROOT
    if not target_path.is_relative_to(WORKSPACE_ROOT):
        raise HTTPException(
            status_code=403, detail="Path traversal detected. Access denied.")
    
    return target_path


def verify_token(authorization: str = Header(None)):
    """Dependency to check the JupyterHub API token."""
    expected_token = os.getenv('JUPYTERHUB_API_TOKEN')
    
    # Only enforce security if the environment actually has a token configured.
    # (This allows you to still run it locally without a token)
    if expected_token:
        if not authorization:
            raise HTTPException(
                status_code=401, detail="Missing Authorization header")
        
        # Strip the "token " prefix and compare
        provided_token = authorization.replace("token ", "").strip()
        if provided_token != expected_token:
            raise HTTPException(status_code=403, detail="Invalid token")


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
    
    # Extract the Origin header from the incoming WebSocket request
    origin = websocket.headers.get("origin")

    is_allowed = False

    # 1. Allow if it matches a static origin or wildcard
    if origin in ORIGINS or "*" in ORIGINS:
        is_allowed = True
    # 2. Allow if it matches our dynamic local regex
    elif origin and re.match(LOCAL_ORIGIN_REGEX, origin):
        is_allowed = True

    if not is_allowed and origin is not None:
        print(f"Blocked WebSocket connection from: {origin}")
        await websocket.close(code=1008)
        return

    # Accept the connection safely
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


@app.post("/api/command", dependencies=[Depends(verify_token)])
async def receive_command(command: dict, client_id: str):
    # ALL commands wait for an acknowledgment from React
    result = await manager.send_and_wait(client_id, command)

    # If React (or the timeout) returned an error, return a 400 Bad Request
    if "error" in result:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.get("/api/clients", dependencies=[Depends(verify_token)])
def get_clients():
    """Return a list of connected client IDs."""
    return {"clients": list(manager.active_connections.keys())}


@app.get("/api/file")
async def serve_local_file(path: str):
    """Securely serve a local file from the Python backend to the React frontend."""
    secure_path = get_secure_path(path)
    
    if not secure_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(secure_path)


@app.get("/api/fs/list")
def list_directory(path: str = "."):
    """Returns the contents of a directory on the server."""

    try:
        secure_path = get_secure_path(path)
    except HTTPException:
        raise HTTPException(status_code=403, detail="Permission denied")

    if not secure_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    EXTENSIONS = ['.fits', '.fit', '.arf', '.rmf', '.rsp', '.pha', '.img']
    EXTENSIONS = tuple(
        f'{ex}{extra}' for ex in EXTENSIONS for extra in ['', '.gz'])

    items = []
    try:
        # Add a "Go Up" option if not at the root
        if secure_path != WORKSPACE_ROOT:
            items.append({
                "name": "..", 
                # Send the relative path back to the client so they stay jailed
                "path": str(secure_path.parent.relative_to(WORKSPACE_ROOT)), 
                "is_dir": True
            })

        for entry in secure_path.iterdir():
            # Hide hidden files
            if entry.name.startswith('.'):
                continue

            is_dir = entry.is_dir()
            
            # If it's a file, only show allowed extensions
            if not is_dir and not entry.name.lower().endswith(EXTENSIONS):
                continue

            items.append({
                "name": entry.name,
                # Store the relative path from the workspace root
                "path": str(entry.relative_to(WORKSPACE_ROOT)),
                "is_dir": is_dir
            })

        # Sort: Directories first, then alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        
        return {
            "current_path": str(secure_path.relative_to(WORKSPACE_ROOT)), 
            "items": items
        }
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")


@app.get("/api/health")
def health_check():
    return {"status": 'OK'}


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
