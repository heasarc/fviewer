import argparse
import uvicorn
from fviewer.server import app


def main():
    parser = argparse.ArgumentParser(
        description="Launch the FViewer server")
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to run the server on")
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host IP")

    args = parser.parse_args()

    print(f"Starting FViewer on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
