import requests


class FViewer:
    def __init__(self, host="127.0.0.1", port=8000, client_id=None):
        self.base_url = f"http://{host}:{port}/api"
        # If None, commands broadcast to all clients
        self.client_id = client_id

    def get_clients(self):
        """List all connected frontend client IDs."""
        response = requests.get(f"{self.base_url}/clients")
        response.raise_for_status()
        return response.json()["clients"]

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
            f"{self.base_url}/command", json=payload, params=params)

        # 4. Handle errors securely
        if response.status_code == 400:
            err = response.json().get('detail', 'Unknown error')
            raise RuntimeError(f"FViewer Error: {err}")

        response.raise_for_status()
        return response.json()

    def load_file(self, path: str):
        return self._send("load_file", path=path)

    def get_colormap(self):
        return self._send("get_colormap")

    def get_stretch(self):
        return self._send("get_stretch")

    def set_colormap(self, cmap: str):
        return self._send("set_colormap", cmap=cmap)

    def set_stretch(self, stretch: str):
        return self._send("set_stretch", stretch=stretch)
