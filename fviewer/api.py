# Copyright 2026, University of Maryland, All Rights Reserved

import os
import time
from typing import Any, Dict, List, Optional

import requests


class FViewer:
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
        host: str = "127.0.0.1",
        port: int = 8000,
        base_url: Optional[str] = None,
        client_id: Optional[str] = None,
    ):
        """
        Initializes the FViewer client connection.

        Args:
            host (str): The hostname for the FViewer server.
            port (int): The port for the FViewer server.
            base_url (str, optional): A direct URL to the API (useful for
                                      remote JupyterLab environments).
            client_id (str, optional): Target a specific connected browser tab.
        """
        if base_url is not None:
            self.base_url = base_url
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

    def load_file(self, path: str) -> Dict[str, Any]:
        """Loads a FITS file into the viewer."""
        return self._send("load_file", path=path)

    def get_colormap(self) -> str:
        """Retrieves the currently active colormap in the image viewer."""
        return self._send("get_colormap").get("colormap", "")

    def get_stretch(self) -> str:
        """Retrieves the currently active image stretch."""
        return self._send("get_stretch").get("stretch", "")

    def set_colormap(self, cmap: str) -> Dict[str, Any]:
        """Sets the colormap for the image viewer."""
        return self._send("set_colormap", cmap=cmap)

    def set_stretch(self, stretch: str) -> Dict[str, Any]:
        """Sets the stretch algorithm for the image viewer."""
        return self._send("set_stretch", stretch=stretch)

    def get_regions(self, format: str = "image") -> List[Dict[str, Any]]:
        """
        Retrieves a list of all currently drawn regions from the viewer.

        Args:
            format (str): 'image' for pixel coords, 'fk5'/'wcs' for RA/Dec.
        """
        if format not in ["image", "fk5", "wcs"]:
            raise ValueError("format must be 'image', 'fk5', or 'wcs'")

        return self._send("get_regions", format=format).get("regions", [])

    def clear_regions(self) -> Dict[str, Any]:
        """Removes all currently drawn regions from the canvas."""
        return self._send("clear_regions")

    def add_circle(
        self,
        x: float,
        y: float,
        radius: float,
        color: str = "#00ff00",
        format: str = "image",
        is_background: bool = False,
    ) -> Dict[str, Any]:
        """Draws a circular region on the image."""
        return self._send(
            "add_region",
            type="circle",
            x=x,
            y=y,
            radius=radius,
            color=color,
            format=format,
            isBackground=is_background,
        )

    def add_box(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        angle: float = 0,
        color: str = "#00ff00",
        format: str = "image",
        is_background: bool = False,
    ) -> Dict[str, Any]:
        """Draws a rectangular box region on the image."""
        return self._send(
            "add_region",
            type="box",
            x=x,
            y=y,
            width=width,
            height=height,
            angle=angle,
            color=color,
            format=format,
            isBackground=is_background,
        )

    def add_ellipse(
        self,
        x: float,
        y: float,
        rx: float,
        ry: float,
        angle: float = 0,
        color: str = "#00ff00",
        format: str = "image",
        is_background: bool = False,
    ) -> Dict[str, Any]:
        """Draws an elliptical region on the image."""
        return self._send(
            "add_region",
            type="ellipse",
            x=x,
            y=y,
            rx=rx,
            ry=ry,
            angle=angle,
            color=color,
            format=format,
            isBackground=is_background,
        )

    def add_annulus(
        self,
        x: float,
        y: float,
        inner_r: float,
        outer_r: float,
        color: str = "#00ff00",
        format: str = "image",
        is_background: bool = False,
    ) -> Dict[str, Any]:
        """Draws an annular (ring) region on the image."""
        return self._send(
            "add_region",
            type="annulus",
            x=x,
            y=y,
            innerR=inner_r,
            outerR=outer_r,
            color=color,
            format=format,
            isBackground=is_background,
        )

    def load_regions(self, filepath: str) -> Dict[str, Any]:
        """Reads a local DS9 `.reg` file and applies it to the viewer."""
        with open(filepath, "r") as f:
            content = f.read()

        return self._send("load_regions_from_string", content=content)

    def save_regions(
        self, filepath: str, format: str = "image"
    ) -> Dict[str, str]:
        """
        Fetches regions from the viewer and saves them to a DS9 `.reg` file.

        Args:
            filepath (str): Destination path. Must end in `.reg` or `.txt`.
            format (str): Coordinate format ('image' or 'fk5').

        Returns:
            Dict[str, str]: Status and output filepath.
        """
        if format not in ["image", "fk5"]:
            raise ValueError("format must be 'image' or 'fk5'")

        safe_exts = (".reg", ".txt")
        if not filepath.lower().endswith(safe_exts):
            raise ValueError(
                f"For security, filepath must end with {safe_exts}"
            )

        response = self._send("get_regions_string", format=format)
        content = response.get("content", "")

        max_bytes = 5 * 1024 * 1024
        if len(content.encode("utf-8")) > max_bytes:
            raise RuntimeError(
                "Received region data exceeds 5MB limit. Aborting save."
            )

        with open(filepath, "w") as f:
            f.write(content)

        return {"status": "ok", "file": filepath}
