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
        payload = {"action": action, **kwargs}
        params = {"client_id": self.client_id} if self.client_id else {}

        response = requests.post(
            f"{self.base_url}/command", json=payload, params=params)
        response.raise_for_status()
        return response.json()

    def load_file(self, path: str):
        return self._send("load_file", path=path)

    def set_colormap(self, cmap: str):
        return self._send("set_colormap", cmap=cmap)

    def set_stretch(self, stretch: str):
        return self._send("set_stretch", stretch=stretch)
