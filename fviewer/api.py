# Copyright 2026, University of Maryland, All Rights Reserved

import os
import requests
import time

class FViewer:
    def __init__(self, host="127.0.0.1", port=8000, base_url=None, client_id=None):
        # if base_url is given, use it, otherwise use host and port
        # e.g. in remote jupyterlab, pass base_url directly
        if base_url is not None:
            self.base_url = base_url
        else:
            self.base_url = f"http://{host}:{port}/api"
        self.headers = {}
        token = os.environ.get('JUPYTERHUB_API_TOKEN', None)
        if token is not None:
            self.headers['Authorization'] = f"token {token}"
        # If None, commands broadcast to all clients
        self.client_id = client_id

    def get_clients(self):
        """List all connected frontend client IDs."""
        response = requests.get(
            f"{self.base_url}/clients", headers=self.headers)
        response.raise_for_status()
        return response.json()["clients"]
    
    def wait_for_ready(self, timeout: int = 15, poll_interval: float = 0.5):
        """Blocks until the Server is up and running.
        """
        start_time = time.time()
        server_up = False
        
        print("Waiting for FViewer to initialize...")

        while time.time() - start_time < timeout:
            # Step 1: Wait for the FastAPI server to be reachable
            if not server_up:
                try:
                    response = requests.get(
                        f"{self.base_url}/health", timeout=1, headers=self.headers)
                    if response.status_code == 200:
                        print('Server is running ...')
                        server_up = True
                except requests.exceptions.RequestException:
                    pass # Server not up yet, keep looping
            
            # Step 2: Once server is up, wait for a React client to connect
            print('Checking for any display client ...')
            if server_up:
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
                    pass # Keep looping until client appears

            time.sleep(poll_interval)
            
        raise TimeoutError(
            f"FViewer timed out after {timeout} seconds waiting "
            "for the browser to connect."
        )

    def _send(self, action: str, **kwargs):
        # 1. If we don't have a client_id yet, try to get one now
        if not self.client_id:
            clients = self.get_clients()
            if not clients:
                raise RuntimeError(
                    ("No browser connected! Please open "
                     "http://127.0.0.1:8000 in your browser first."))
            self.client_id = clients[0]
            print(f"Auto-connected to display client: {self.client_id}")

        # 2. Prepare payload and parameters
        payload = {"action": action, **kwargs}
        params = {"client_id": self.client_id}

        # 3. Send the request
        response = requests.post(
            f"{self.base_url}/command", json=payload,
            params=params, headers=self.headers)

        # 4. Handle errors securely
        if response.status_code == 400:
            err = response.json().get('detail', 'Unknown error')
            raise RuntimeError(f"FViewer Error: {err}")

        response.raise_for_status()
        return response.json()

    def load_file(self, path: str):
        return self._send("load_file", path=path)

    def get_colormap(self):
        return self._send("get_colormap").get('colormap', '')

    def get_stretch(self):
        return self._send("get_stretch").get('stretch', '')

    def set_colormap(self, cmap: str):
        return self._send("set_colormap", cmap=cmap)

    def set_stretch(self, stretch: str):
        return self._send("set_stretch", stretch=stretch)

    def get_regions(self) -> list:
        """Returns the raw internal list of region dictionaries."""
        return self._send("get_regions").get("regions", [])

    def clear_regions(self):
        """Removes all drawn regions."""
        return self._send("clear_regions")

    def add_circle(self, x: float, y: float, radius: float,
                   color: str = '#00ff00'):
        return self._send(
            "add_region", type="circle", x=x, y=y, radius=radius, color=color)

    def add_box(self, x: float, y: float, width: float, height: float,
                angle: float = 0, color: str = '#00ff00'):
        return self._send(
            "add_region", type="box", x=x, y=y, width=width, height=height,
            angle=angle, color=color)

    def add_ellipse(self, x: float, y: float, rx: float, ry: float,
                    angle: float = 0, color: str = '#00ff00'):
        return self._send("add_region", type="ellipse", x=x, y=y, rx=rx, ry=ry,
                   angle=angle, color=color)

    def add_annulus(self, x: float, y: float, inner_r: float,
                    outer_r: float, color: str = '#00ff00'):
        return self._send("add_region", type="annulus", x=x, y=y, innerR=inner_r,
                   outerR=outer_r, color=color)
