# tests/test_server.py
import pytest
from fastapi.testclient import TestClient
from fastapi import WebSocketDisconnect

# Absolute imports from the fviewer package
from fviewer.server import app, manager

# Initialize the test client
client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "OK"}


def test_secure_file_serving_blocks_traversal():
    """Test that our pathlib security fix works."""
    malicious_path = "../../../../../etc/passwd"
    response = client.get(f"/api/file?path={malicious_path}")

    assert response.status_code == 403
    assert "Path traversal detected" in response.json()["detail"]


def test_websocket_connection_and_client_list():
    """Test that a frontend can connect and register its ID."""
    client_id = "test_browser_1"

    with client.websocket_connect(f"/ws/{client_id}") as _:
        response = client.get("/api/clients")
        assert response.status_code == 200
        assert client_id in response.json()["clients"]


# --- NEW TOKEN AUTHENTICATION TESTS ---

def test_verify_token_missing(monkeypatch):
    """Test 401 when token is required but missing."""
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "secret123")
    response = client.get("/api/clients")
    assert response.status_code == 401
    assert "Missing Authorization header" in response.json()["detail"]


def test_verify_token_invalid(monkeypatch):
    """Test 403 when token is provided but incorrect."""
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "secret123")
    response = client.get(
        "/api/clients", headers={"Authorization": "token wrong"})
    assert response.status_code == 403
    assert "Invalid token" in response.json()["detail"]


def test_verify_token_valid(monkeypatch):
    """Test 200 when correct token is provided."""
    monkeypatch.setenv("JUPYTERHUB_API_TOKEN", "secret123")
    # Need an active WS connection so the list isn't empty,
    # but empty is fine for testing auth
    response = client.get(
        "/api/clients", headers={"Authorization": "token secret123"})
    assert response.status_code == 200


# --- NEW WEBSOCKET CSWSH SECURITY TEST ---

def test_websocket_cswsh_blocked():
    """Test that mismatched Origin and Host headers trigger
    a 1008 disconnect."""
    client_id = "hacker_client"

    # Try to connect with an Origin that doesn't match the
    # Host and isn't localhost
    headers = {
        "Origin": "http://evil-site.com",
        "Host": "localhost:8000"
    }

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/ws/{client_id}", headers=headers):
            pass

    assert exc_info.value.code == 1008


# --- NEW REST API COMMAND TESTS ---

def test_api_command_success(monkeypatch):
    """Test that the REST endpoint successfully routes the command."""
    # Mock the async send_and_wait to return instantly
    async def mock_send(*args, **kwargs):
        return {"status": "ok", "data": "success"}
    monkeypatch.setattr(manager, "send_and_wait", mock_send)

    response = client.post(
        "/api/command?client_id=fake", json={"action": "test"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "data": "success"}


def test_api_command_error(monkeypatch):
    """Test that the REST endpoint bubbles up errors as 400."""
    async def mock_send(*args, **kwargs):
        return {"error": "Client offline"}
    monkeypatch.setattr(manager, "send_and_wait", mock_send)

    response = client.post(
        "/api/command?client_id=fake", json={"action": "test"})
    assert response.status_code == 400
    assert "Client offline" in response.json()["detail"]


# --- ASYNC MANAGER TESTS ---

class MockWebSocket:
    """Helper mock for async tests."""
    def __init__(self):
        self.sent_messages = []

    async def accept(self):
        pass

    async def send_json(self, data):
        self.sent_messages.append(data)


@pytest.mark.asyncio
async def test_send_and_wait_core_logic():
    """Test the asyncio Future logic directly without TestClient deadlocks."""
    client_id = "test_async_client"
    mock_ws = MockWebSocket()

    # Override send_json just for this test to instantly resolve the future
    async def instant_resolve(data):
        mock_ws.sent_messages.append(data)
        msg_id = data.get("message_id")
        if msg_id and msg_id in manager.pending_requests:
            manager.pending_requests[msg_id].set_result({
                "message_id": msg_id,
                "status": "ok",
                "data": "simulated_response"
            })
    mock_ws.send_json = instant_resolve

    await manager.connect(client_id, mock_ws)
    result = await manager.send_and_wait(client_id, {"action": "test"})

    assert result["status"] == "ok"
    assert result["data"] == "simulated_response"
    assert len(mock_ws.sent_messages) == 1

    manager.disconnect(client_id)


@pytest.mark.asyncio
async def test_send_and_wait_timeout():
    """Test that waiting for a frontend reply properly times out."""
    client_id = "slow_client"
    mock_ws = MockWebSocket()
    # Notice we DO NOT instantly resolve the future here

    await manager.connect(client_id, mock_ws)

    # Set a tiny timeout so it fails immediately
    result = await manager.send_and_wait(
        client_id, {"action": "test"}, timeout=0.01)

    assert "error" in result
    assert "Timeout" in result["error"]

    manager.disconnect(client_id)


@pytest.mark.asyncio
async def test_send_and_wait_not_connected():
    """Test error when trying to send to an offline client."""
    result = await manager.send_and_wait("ghost_client", {"action": "test"})
    assert "error" in result
    assert "not connected" in result["error"]


@pytest.mark.asyncio
async def test_broadcast_and_send_to_client():
    """Test fire-and-forget sending methods."""
    ws1, ws2 = MockWebSocket(), MockWebSocket()

    await manager.connect("c1", ws1)
    await manager.connect("c2", ws2)

    # Test broadcast
    await manager.broadcast({"type": "ping"})
    assert len(ws1.sent_messages) == 1
    assert len(ws2.sent_messages) == 1

    # Test targeted send
    await manager.send_to_client("c1", {"type": "targeted"})
    assert len(ws1.sent_messages) == 2
    assert len(ws2.sent_messages) == 1  # ws2 did not get it

    # Test sending to invalid client (should not crash)
    await manager.send_to_client("ghost", {"type": "void"})

    manager.disconnect("c1")
    manager.disconnect("c2")


def test_websocket_cswsh_allowed_local():
    """Hits the LOCAL_ORIGIN_REGEX allow branch (Lines 183-185)."""
    client_id = "local_client"
    headers = {
        "Origin": "http://127.0.0.1:5173",  # Matches local regex
        "Host": "example.com"  # Host doesn't match, proving Regex worked
    }
    with client.websocket_connect(f"/ws/{client_id}", headers=headers):
        assert client_id in manager.active_connections


def test_websocket_cswsh_allowed_same_origin():
    """Hits the dynamic Same-Origin allow branch (Lines 186-191)."""
    client_id = "jupyter_client"
    headers = {
        "Origin": "https://jupyterhub.nasa.gov",
        "Host": "jupyterhub.nasa.gov"       # Host strictly matches Origin
    }
    with client.websocket_connect(f"/ws/{client_id}", headers=headers):
        assert client_id in manager.active_connections
