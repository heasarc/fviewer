# fviewer/tests/test_plugin_tap_proxy.py
import pytest
import requests
import responses
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fviewer.server_plugins.tap_proxy import router

# --- Fixture ---


@pytest.fixture
def client():
    """Sets up a dummy FastAPI app with our TAP proxy router."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# --- Tests ---

@responses.activate
def test_proxy_tap_query_success(client):
    """Test a successful TAP query proxies the XML data back."""

    # 1. Mock the external TAP server response
    mock_url = "http://mock-heasarc.org/tap"
    mock_xml = "<VOTABLE><RESOURCE><TABLE></TABLE></RESOURCE></VOTABLE>"

    responses.add(
        responses.GET,
        f"{mock_url}/sync",
        body=mock_xml,
        status=200
    )

    # 2. Send the request to our FastAPI router
    response = client.post(
        "/api/tap-proxy",
        json={
            "url": mock_url,
            "query": "SELECT TOP 10 * FROM public.m82"
        }
    )

    # 3. Assertions
    assert response.status_code == 200
    assert response.json()["xmlString"] == mock_xml

    # Optional: Verify our proxy sent the correct query parameters upstream
    assert len(responses.calls) == 1
    req_url = responses.calls[0].request.url
    assert "REQUEST=doQuery" in req_url
    assert "LANG=ADQL" in req_url
    assert "FORMAT=votable" in req_url


@responses.activate
def test_proxy_tap_query_http_error(client):
    """Test handling of 4xx/5xx errors returned by the TAP server."""

    mock_url = "http://mock-heasarc.org/tap"
    error_message = "Syntax error in ADQL statement"

    # Mock the TAP server returning a 400 Bad Request
    responses.add(
        responses.GET,
        f"{mock_url}/sync",
        body=error_message,
        status=400
    )

    response = client.post(
        "/api/tap-proxy",
        json={"url": mock_url, "query": "SELECT * BAD_SYNTAX"}
    )

    # Our proxy should catch the HTTPError and relay the 400 status and message
    assert response.status_code == 400
    assert "TAP Service Error" in response.json()["detail"]
    assert error_message in response.json()["detail"]


@responses.activate
def test_proxy_tap_query_network_error(client):
    """Test handling of extreme network errors (timeouts, DNS failures)."""

    mock_url = "http://mock-heasarc.org/tap"

    # Mock a catastrophic network timeout
    responses.add(
        responses.GET,
        f"{mock_url}/sync",
        body=requests.exceptions.ReadTimeout("Connection timed out")
    )

    response = client.post(
        "/api/tap-proxy",
        json={"url": mock_url, "query": "SELECT * FROM massive_table"}
    )

    # Our proxy should catch the RequestException and return a safe 500
    assert response.status_code == 500
    assert "Request failed:" in response.json()["detail"]
    assert "Connection timed out" in response.json()["detail"]
