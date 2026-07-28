# Copyright 2026, University of Maryland, All Rights Reserved

"""
FastAPI Server Backend for FViewer.

This server acts as the secure middleman between the Python Jupyter client
(`api.py`) and the React/WASM frontend.

Key Responsibilities:
1. Serves the static Vite build (React frontend).
2. Manages WebSocket connections for real-time UI control.
3. Bridges synchronous Python API calls to the asynchronous React UI
   using an `asyncio.Future` pattern (`send_and_wait`).
4. Enforces strict security boundaries, including token authentication,
   CORS regex matching, Cross-Site WebSocket Hijacking (CSWSH) prevention,
   and Path Traversal jailing.
"""

import asyncio
import os
import re
import uuid
import signal
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket
from fastapi import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import the File System Plugin Router
from .server_plugins.file_system import router as file_system_router

# TAP proxy plugin
from .server_plugins.tap_proxy import router as tap_proxy_router

# If running standalone, this defaults to "" (empty string)
# If running in Jupyter, this becomes "/fviewer"
ROOT_PATH = os.getenv("FVIEWER_ROOT_PATH", "")

# Where the static files are
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Define the URLs that are allowed to talk to this API
ORIGINS = [os.getenv("FVIEWER_ORIGIN", "")]

# Regex to allow ANY port on localhost or 127.0.0.1
# Matches: http://localhost:8123, http://127.0.0.1:40593, etc.
LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$"


app = FastAPI(title="FViewer API", root_path=ROOT_PATH)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the Plugin Routers
app.include_router(file_system_router)
app.include_router(tap_proxy_router)


def verify_token(authorization: str = Header(None)):
    """
    Dependency to check the JupyterHub API token for sensitive endpoints.

    Only enforces security if the environment actually has a token configured.
    This allows local developers to run the server without a token while
    protecting remote JupyterHub deployments.

    Args:
        authorization (str): The HTTP Authorization header.

    Raises:
        HTTPException: 401 if missing, 403 if invalid.
    """
    expected_token = os.getenv("JUPYTERHUB_API_TOKEN")

    if expected_token:
        if not authorization:
            raise HTTPException(
                status_code=401, detail="Missing Authorization header"
            )

        provided_token = authorization.replace("token ", "").strip()
        if provided_token != expected_token:
            raise HTTPException(status_code=403, detail="Invalid token")


class ConnectionManager:
    """
    Manages active WebSocket connections and async request routing.
    """

    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.pending_requests: dict[str, asyncio.Future] = {}

    async def connect(self, client_id: str, websocket: WebSocket):
        """Accepts and stores a new WebSocket connection."""
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        """Removes a disconnected WebSocket."""
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_to_client(self, client_id: str, message: dict):
        """Sends a Fire-and-Forget message to a specific client."""
        if ws := self.active_connections.get(client_id):
            await ws.send_json(message)

    async def broadcast(self, message: dict):
        """Broadcasts a message to all connected React clients."""
        for ws in self.active_connections.values():
            await ws.send_json(message)

    async def send_and_wait(
        self, client_id: str, message: dict, timeout=5.0
    ) -> dict:
        """
        Sends a message to the React frontend and waits for its reply.

        This uses an `asyncio.Future` pattern. A unique message_id is
        generated, sent over the WebSocket, and the function awaits the Future.
        The WebSocket listener endpoint resolves the Future when the React
        client responds with the matching message_id.

        Args:
            client_id (str): Target frontend client.
            message (dict): Payload to send.
            timeout (float): Maximum wait time in seconds.

        Returns:
            dict: The response payload from React, or an error dictionary.
        """
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
    """
    WebSocket endpoint connecting the React UI to the FastAPI server.

    SECURITY (CSWSH Prevention): Explicitly validates the `Origin` header
    against the `Host` header to block Cross-Site WebSocket Hijacking.
    """
    origin = websocket.headers.get("origin")
    host = websocket.headers.get("x-forwarded-host") or websocket.headers.get(
        "host"
    )

    is_allowed = False

    # 1. Allow if it matches a static origin or wildcard
    if origin in ORIGINS or "*" in ORIGINS:
        is_allowed = True
    # 2. Allow if it matches our dynamic local regex
    elif origin and re.match(LOCAL_ORIGIN_REGEX, origin):
        is_allowed = True
    # 3. Dynamically allow Same-Origin requests (Jupyter Proxy support)
    elif origin and host:
        origin_host = urlparse(origin).netloc
        if origin_host == host:
            is_allowed = True

    if not is_allowed and origin is not None:
        print(f"Blocked WebSocket connection from: {origin}")
        await websocket.close(code=1008)
        return

    await manager.connect(client_id, websocket)
    try:
        while True:
            # Listen for replies from React
            data = await websocket.receive_json()
            msg_id = data.get("message_id")

            # Resolve the pending Future if a Python client is waiting
            if msg_id and msg_id in manager.pending_requests:
                manager.pending_requests[msg_id].set_result(data)
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        print(f"Browser connection closed (Client: {client_id}).")

        # If no more tabs are open, shut down the server
        if len(manager.active_connections) == 0:
            # SAFETY CHECK: Only auto-shutdown if outside Jupyterlab
            # FVIEWER_ROOT_PATH is defined by the fviewer-labextension
            if not os.getenv("FVIEWER_ROOT_PATH"):
                print("All browsers closed. Shutting down local server...")
                os.kill(os.getpid(), signal.SIGINT)


@app.post("/api/command", dependencies=[Depends(verify_token)])
async def receive_command(command: dict, client_id: str):
    """
    REST endpoint hit by the Python API client (`api.py`).
    Routes the command to the React frontend via WebSocket and waits
    for the acknowledgment/data response.
    """
    result = await manager.send_and_wait(client_id, command)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@app.get("/api/clients", dependencies=[Depends(verify_token)])
def get_clients():
    """Returns a list of connected browser client IDs."""
    return {"clients": list(manager.active_connections.keys())}


@app.get("/api/health")
def health_check():
    """Simple health check endpoint used by the Python client bootstrapper."""
    return {"status": "OK"}


# Serve the compiled React application (if built)
if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
