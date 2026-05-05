# Copyright 2026, University of Maryland, All Rights Reserved

import argparse
import uvicorn
import webbrowser
import threading
from fviewer.server import app


def open_browser(url: str):
    """Opens the web browser to the specified URL."""
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(
        description="Launch the FViewer server")
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

    # Launch FastAPI (this blocks the main thread)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
