# fviewer/server_plugins/tap_proxy.py
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class TAPQueryPayload(BaseModel):
    url: str
    query: str


# CRITICAL: Notice this is `def`, NOT `async def`!
# FastAPI will automatically run this in a background thread so it
# doesn't block your WebSockets while waiting for the TAP service.
@router.post("/api/tap-proxy")
def proxy_tap_query(payload: TAPQueryPayload):
    """
    Proxies TAP queries through the FastAPI server to bypass browser CORS.
    """
    try:
        base_url = payload.url.rstrip("/")

        response = requests.get(
            f"{base_url}/sync",
            params={
                "REQUEST": "doQuery",
                "LANG": "ADQL",
                "QUERY": payload.query,
                "FORMAT": "votable"
            },
            timeout=60.0  # Generous timeout for large queries
        )

        # Bubble up HTTP errors (404, 500, etc) from the remote service
        response.raise_for_status()

        return {"xmlString": response.text}

    except requests.exceptions.HTTPError as e:
        # If the TAP service returns an error message (like bad ADQL syntax)
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"TAP Service Error: {e.response.text}"
        )
    except requests.exceptions.RequestException as e:
        # Network errors, timeouts, etc.
        raise HTTPException(
            status_code=500, detail=f"Request failed: {str(e)}")
