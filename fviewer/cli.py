# Copyright 2026, University of Maryland, All Rights Reserved

import argparse
import uvicorn
import webbrowser
import threading
import os
import sys
import socket
from fviewer.server import app
from fviewer.api import FViewer


def open_browser(url: str):
    """Opens the web browser to the specified URL."""
    webbrowser.open(url)


def open_file_on_startup(filepath, host="127.0.0.1", port=8000):
    """Run in a background thread to wait for the UI and load a file"""
    fv = FViewer(host=host, port=port)
    try:
        fv.wait_for_ready()
        print(f"Loading {filepath} into FViewer...")
        fv.load_file(filepath)
    except Exception as e:
        print(f"Failed to load file on startup: {e}")


def find_available_port(
        host: str, start_port: int, max_attempts: int = 100) -> int:
    """Finds an available port by incrementing until one is free."""
    port = start_port
    for _ in range(max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                # Try to bind to the port to see if it's available
                s.bind((host, port))
                return port
            except OSError:
                # Port is in use, increment and try again
                port += 1

    # If we get here and max_attempts was 1,
    # it means the explicit port was taken
    if max_attempts == 1:
        raise RuntimeError(
            f"Port {start_port} is already in use on {host}. "
            "Pass another port, or remove --port to use any open port."
        )
    raise RuntimeError(("Could not find an available port on "
                        f"{host} starting from {start_port}"))


def main():
    parser = argparse.ArgumentParser(
        description="Launch the FViewer server")
    parser.add_argument(
        "filepath", nargs="?",  help="Path to a FITS file to open on launch")
    parser.add_argument(
        "--port", type=int, default=None,
        help=("Port to run the server on. "
              "Default is to use any open port in 8000:8100")
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host IP")
    parser.add_argument(
        "--no-browser", action="store_true", default=False,
        help="Don't open the browser automatically")

    args = parser.parse_args()

    # --- Port Selection Logic ---
    try:
        if args.port is not None:
            # User explicitly requested a port.
            # Try ONLY that port (max_attempts=1).
            actual_port = find_available_port(
                args.host, args.port, max_attempts=1)
        else:
            # No port specified. Start at 8000 and increment if needed.
            actual_port = find_available_port(
                args.host, 8000, max_attempts=100)
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)

    url = f"http://{args.host}:{actual_port}"

    # do the check here before starting the browser
    abs_path = None
    if args.filepath:
        abs_path = abs_path = os.path.abspath(args.filepath)
        if not os.path.exists(abs_path):
            print(f"Error: File not found -> {abs_path}")
            sys.exit(1)
        # Start the client commands in a background thread
        # daemon=True ensures this thread doesn't prevent the app from exiting
        threading.Thread(
            target=open_file_on_startup,
            args=(abs_path, args.host, actual_port),
            daemon=True
        ).start()

    print(f"Starting FViewer at {url}")

    # Schedule the browser to open 1 second from now in a background thread
    if not args.no_browser:
        threading.Timer(1.0, open_browser, args=(url,)).start()

    # Launch FastAPI (this blocks the main thread)
    uvicorn.run(app, host=args.host, port=actual_port, log_level="info")


if __name__ == "__main__":
    main()
