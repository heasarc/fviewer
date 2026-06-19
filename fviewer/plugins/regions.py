# Copyright 2026, University of Maryland, All Rights Reserved

from typing import Any, Dict, List


class RegionsMixin:
    """Methods for managing and drawing regions on the FViewer canvas."""

    def get_regions(self, format: str = "image") -> List[Dict[str, Any]]:
        """
        Retrieves a list of all currently drawn regions from the viewer.

        Args:
            format (str): The coordinate system to return the regions in.
                Valid options are 'image' (pixel coordinates), 'physical',
                'fk5' (RA/Dec), or 'wcs'. Defaults to "image".

        Returns:
            List[Dict[str, Any]]: A list of dictionaries, where each dictionary
            represents a region and its properties (type, coordinates,
            color, etc.).

        Raises:
            ValueError: If an unsupported format string is provided.
        """
        valid_formats = ["image", "physical", "fk5", "wcs"]
        if format not in valid_formats:
            raise ValueError(
                "format must be 'image', 'physical', 'fk5', or 'wcs'"
            )

        return self._send("get_regions", format=format).get("regions", [])

    def clear_regions(self) -> Dict[str, Any]:
        """
        Removes all currently drawn regions from the canvas.

        Returns:
            Dict[str, Any]: A dictionary containing the status of the operation
            (e.g., `{"status": "ok"}`).
        """
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
        """
        Draws a circular region on the image.

        Args:
            x (float): The X coordinate (or RA) of the circle's center.
            y (float): The Y coordinate (or Dec) of the circle's center.
            radius (float): The radius of the circle.
            color (str): Hex color code for the region outline.
                Defaults to "#00ff00".
            format (str): The coordinate system used for x, y, and radius.
                Options: 'image', 'physical', 'fk5', 'wcs'.
                Defaults to "image".
            is_background (bool): If True, designates this region
                as a background estimation area (typically rendered
                with a dashed line).

        Returns:
            Dict[str, Any]: Server acknowledgment of the command.
        """
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
        """
        Draws a rectangular box region on the image.

        Args:
            x (float): The X coordinate (or RA) of the box's center.
            y (float): The Y coordinate (or Dec) of the box's center.
            width (float): The full width of the box.
            height (float): The full height of the box.
            angle (float): Rotation angle in degrees (counter-clockwise).
                Defaults to 0.
            color (str): Hex color code for the region outline.
                Defaults to "#00ff00".
            format (str): The coordinate system used. Defaults to "image".
            is_background (bool): Designates as a background region.
                Defaults to False.

        Returns:
            Dict[str, Any]: Server acknowledgment of the command.
        """
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
        """
        Draws an elliptical region on the image.

        Args:
            x (float): The X coordinate (or RA) of the ellipse's center.
            y (float): The Y coordinate (or Dec) of the ellipse's center.
            rx (float): The semi-major axis radius.
            ry (float): The semi-minor axis radius.
            angle (float): Rotation angle in degrees. Defaults to 0.
            color (str): Hex color code for the region outline.
                Defaults to "#00ff00".
            format (str): The coordinate system used. Defaults to "image".
            is_background (bool): Designates as a background region.
                Defaults to False.

        Returns:
            Dict[str, Any]: Server acknowledgment of the command.
        """
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
        """
        Draws an annular (ring) region on the image.

        Args:
            x (float): The X coordinate (or RA) of the annulus center.
            y (float): The Y coordinate (or Dec) of the annulus center.
            inner_r (float): The inner radius of the ring.
            outer_r (float): The outer radius of the ring.
            color (str): Hex color code for the region outline.
                Defaults to "#00ff00".
            format (str): The coordinate system used. Defaults to "image".
            is_background (bool): Designates as a background region.
                Defaults to False.

        Returns:
            Dict[str, Any]: Server acknowledgment of the command.
        """
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
        """
        Reads a local DS9 `.reg` file and applies it to the viewer.

        Args:
            filepath (str): The absolute or relative path to the
                region file on disk.

        Returns:
            Dict[str, Any]: Server acknowledgment after parsing and drawing.
        """
        with open(filepath, "r") as f:
            content = f.read()

        return self._send("load_regions_from_string", content=content)

    def save_regions(
        self, filepath: str, format: str = "image"
    ) -> Dict[str, str]:
        """
        Fetches regions from the viewer and saves them to a `.reg` file.

        This method requests a formatted DS9 region string from the React
        frontend and writes it securely to the local disk. It includes
        safeguards against unsupported extensions and excessively large
        memory payloads.

        Args:
            filepath (str): The destination path for the saved file.
                Must end with '.reg' or '.txt'.
            format (str): The coordinate system to save the regions in.
                Options: 'image' or 'fk5'. Defaults to "image".

        Returns:
            Dict[str, str]: A dictionary containing the status and the
                saved file path.

        Raises:
            ValueError: If an invalid format or unsafe file extension is
                provided.
            RuntimeError: If the region payload returned by the UI exceeds 5MB.
        """
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
