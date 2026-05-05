# Copyright 2026, University of Maryland, All Rights Reserved

import argparse
import uvicorn
import webbrowser
import threading
import os
import sys
from fviewer.server import app


def open_browser(url: str):
    """Opens the web browser to the specified URL."""
    webbrowser.open(url)

def open_file_on_startup(filepath, host="127.0.0.1", port=8000):
    """Run in a background thread to wait for the UI and load a file"""
    from fviewer.api import FViewer
    fv = FViewer(host=host, port=port)
    try:
        fv.wait_for_ready()
        print(f"Loading {filepath} into FViewer...")
        fv.load_file(filepath)
    except Exception as e:
        print(f"Failed to load file on startup: {e}")

def main():
    parser = argparse.ArgumentParser(
        description="Launch the FViewer server")
    parser.add_argument(
        "filepath", nargs="?",  help="Path to a FITS file to open on launch")
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to run the server on")
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host IP")
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't open the browser automatically")

    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}"

    print(f"Starting FViewer on {url}")

    # Schedule the browser to open 1 second from now in a background thread
    if not args.no_browser:
        threading.Timer(1.0, open_browser, args=(url,)).start()
    
    if args.filepath:
        abs_path = os.path.abspath(args.filepath)
        if not os.path.exists(abs_path):
            print(f"Error: File not found -> {abs_path}")
            sys.exit(1)
        # Start the client commands in a background thread
        # daemon=True ensures this thread doesn't prevent the app from exiting
        threading.Thread(
            target=open_file_on_startup, 
            args=(abs_path, args.host, args.port), 
            daemon=True
        ).start()

    # Launch FastAPI (this blocks the main thread)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
