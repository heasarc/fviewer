# Copyright 2026, University of Maryland, All Rights Reserved

from typing import Any, Dict


class ImageControlMixin:
    """Methods for controlling the FViewer canvas display."""

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
