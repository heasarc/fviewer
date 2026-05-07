# tests/test_server.py
import pytest
from fastapi.testclient import TestClient
import concurrent.futures

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
    
    with client.websocket_connect(f"/ws/{client_id}") as websocket:
        response = client.get("/api/clients")
        assert response.status_code == 200
        assert client_id in response.json()["clients"]

@pytest.mark.asyncio
async def test_send_and_wait_core_logic():
    """Test the asyncio Future logic directly without TestClient deadlocks."""
    from fviewer.server import manager
    
    client_id = "test_async_client"
    
    # 1. Create a mock WebSocket to act like React
    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []
            
        async def accept(self):
            pass
            
        async def send_json(self, data):
            # The server calls this to send data to React.
            self.sent_messages.append(data)
            
            # SIMULATE REACT REPLYING INSTANTLY:
            # As soon as the server sends the command, we grab the message_id
            # and fulfill the pending Future (just like websocket_endpoint would).
            msg_id = data.get("message_id")
            if msg_id and msg_id in manager.pending_requests:
                manager.pending_requests[msg_id].set_result({
                    "message_id": msg_id, 
                    "status": "ok",
                    "data": "simulated_response"
                })

    mock_ws = MockWebSocket()
    
    # 2. Connect the mock socket
    await manager.connect(client_id, mock_ws)
    
    # 3. Call send_and_wait. This will:
    #    - Create the asyncio Future
    #    - Call mock_ws.send_json() (which instantly fulfills the Future)
    #    - Await the Future and return the result
    command_payload = {"action": "set_colormap"}
    result = await manager.send_and_wait(client_id, command_payload)
    
    # 4. Verify the flow worked perfectly!
    assert result["status"] == "ok"
    assert result["data"] == "simulated_response"
    assert len(mock_ws.sent_messages) == 1
    
    # Cleanup
    manager.disconnect(client_id)