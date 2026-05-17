# Copyright 2026, University of Maryland, All Rights Reserved

from typing import Any, Dict, List


class RegionsMixin:
    """Methods for managing and drawing regions on the FViewer canvas."""

    def get_regions(self, format: str = "image") -> List[Dict[str, Any]]:
        """Retrieves a list of all currently drawn regions from the viewer."""
        valid_formats = ["image", "physical", "fk5", "wcs"]
        if format not in valid_formats:
            raise ValueError(
                "format must be 'image', 'physical', 'fk5', or 'wcs'"
            )

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
        """Fetches regions from the viewer and saves them to a `.reg` file."""
        if format not in ["image", "physical", "fk5"]:
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
