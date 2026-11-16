# Copyright 2026, University of Maryland, All Rights Reserved

import io
import os
import time
from typing import Any, Dict, List, Optional, Union

import requests
from urllib.parse import urljoin

from .plugins.image_control import ImageControlMixin
from .plugins.regions import RegionsMixin
from .plugins.datacube import DataCubeMixin


class FViewer(ImageControlMixin, RegionsMixin, DataCubeMixin):
    """
    A Python client to control the FViewer browser-based application.

    This class allows users to programmatically load files, adjust UI
    settings (colormaps, stretches), and manage regions via a REST API
    to the FViewer backend.

    Attributes:
        base_url (str): The base URL of the FastAPI backend.
        headers (dict): HTTP headers for authentication (e.g., Jupyter token).
        client_id (str): The specific browser client ID to control. If None,
                         it will auto-connect to the first available client.
    """

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        base_url: Optional[str] = None,
        client_id: Optional[str] = None,
    ):
        """
        Initializes the FViewer client connection.

        Args:
            host (str, optional): The hostname for the FViewer server.
            port (int, optional): The port for the FViewer server.
            base_url (str, optional): A direct URL to the API (useful for
                                      remote JupyterLab environments).
            client_id (str, optional): Target a specific connected browser tab.
        """
        default_url = 'http://127.0.0.1:8000/api'
        if base_url is not None:
            self.base_url = base_url
        elif host is None or port is None:
            # check environment variables in case we are inside jupyterlab
            url = os.environ.get('JUPYTER_SERVER_URL')
            if url is None:
                url = os.environ.get('JUPYTERHUB_SERVICE_URL')
            if url is None:
                # fall back to the default
                self.base_url = default_url
            else:
                self.base_url = urljoin(url, 'fviewer/api')
        else:
            self.base_url = f"http://{host}:{port}/api"

        self.headers = {}
        token = os.environ.get("JUPYTERHUB_API_TOKEN", None)
        if token is not None:
            self.headers["Authorization"] = f"token {token}"

        self.client_id = client_id

    def get_clients(self) -> List[str]:
        """
        Retrieves a list of all currently connected frontend browser
        client IDs.

        Returns:
            List[str]: A list of active client IDs.

        Raises:
            requests.exceptions.HTTPError: If the backend request fails.
        """
        response = requests.get(
            f"{self.base_url}/clients", headers=self.headers
        )
        response.raise_for_status()
        return response.json()["clients"]

    def wait_for_ready(
        self, timeout: int = 15, poll_interval: float = 0.5
    ) -> bool:
        """
        Blocks execution until the FViewer FastAPI server is running and a
        browser client has connected via WebSocket.

        Args:
            timeout (int): Maximum time to wait in seconds. Defaults to 15.
            poll_interval (float): Time between checks. Defaults to 0.5.

        Returns:
            bool: True if the server and client are ready.

        Raises:
            TimeoutError: If no browser client connects within the timeout.
        """
        start_time = time.time()
        server_up = False

        print("Waiting for FViewer to initialize...")

        while time.time() - start_time < timeout:
            if not server_up:
                try:
                    response = requests.get(
                        f"{self.base_url}/health",
                        timeout=1,
                        headers=self.headers,
                    )
                    if response.status_code == 200:
                        print("Server is running ...")
                        server_up = True
                except requests.exceptions.RequestException:
                    pass  # Server not up yet, keep looping

            if server_up:
                print("Checking for any display client ...")
                try:
                    clients = self.get_clients()
                    if len(clients) != 0:
                        self.client_id = clients[0]
                        print(
                            "Ready! Auto-connected to display client: "
                            f"{self.client_id}"
                        )
                        return True
                except Exception:
                    pass  # Keep looping until client appears

            time.sleep(poll_interval)

        raise TimeoutError(
            f"FViewer timed out after {timeout} seconds waiting "
            "for the browser to connect."
        )

    def _send(self, action: str, **kwargs) -> Dict[str, Any]:
        """
        Internal helper method to send command payloads to the backend server.

        Args:
            action (str): The command action to perform.
            **kwargs: Additional parameters required by the specific action.

        Returns:
            Dict[str, Any]: The JSON response from the server.

        Raises:
            RuntimeError: If no browser is connected or a 400 error occurs.
        """
        if not self.client_id:
            clients = self.get_clients()
            if not clients:
                raise RuntimeError(
                    "No browser connected! Please open "
                    "http://127.0.0.1:8000 in your browser first."
                )
            self.client_id = clients[0]
            print(f"Auto-connected to display client: {self.client_id}")

        payload = {"action": action, **kwargs}
        params = {"client_id": self.client_id}

        response = requests.post(
            f"{self.base_url}/command",
            json=payload,
            params=params,
            headers=self.headers,
        )

        if response.status_code == 400:
            err = response.json().get("detail", "Unknown error")
            raise RuntimeError(f"FViewer Error: {err}")

        response.raise_for_status()
        return response.json()

    def load_file(
        self,
        path_or_hdulist: Union[str, Any],
        *,
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Loads a FITS file into the viewer.

        Args:
            path_or_hdulist: Either a filesystem path (str) to a FITS file,
                or an ``astropy.io.fits.HDUList`` object.
            name: Display filename shown in the viewer UI. Only used when
                an HDUList is passed. Defaults to ``"memory.fits"``.

        Returns:
            The JSON acknowledgment from the frontend.

        Raises:
            TypeError: If *path_or_hdulist* is neither a str nor an HDUList.
        """
        if isinstance(path_or_hdulist, str):
            return self._send("load_file", path=path_or_hdulist)

        # Defer the import so astropy remains an optional dependency
        try:
            from astropy.io.fits import HDUList
        except ImportError:
            raise TypeError(
                "path_or_hdulist must be a string path or an "
                "astropy.io.fits.HDUList. "
                "Install astropy to pass HDUList objects."
            )

        if not isinstance(path_or_hdulist, HDUList):
            raise TypeError(
                "path_or_hdulist must be a string path or an "
                "astropy.io.fits.HDUList, "
                f"got {type(path_or_hdulist).__name__}."
            )

        display_name = name or "memory.fits"

        # Serialize the HDUList into an in-memory FITS byte stream
        buf = io.BytesIO()
        path_or_hdulist.writeto(buf)
        buf.seek(0)

        # Upload the bytes to the server's temporary store
        upload_resp = requests.post(
            f"{self.base_url}/upload",
            files={"file": (display_name, buf, "application/octet-stream")},
            headers=self.headers,
        )
        upload_resp.raise_for_status()
        upload_id = upload_resp.json()["upload_id"]

        return self._send(
            "load_file", upload_id=upload_id, name=display_name
        )
