import re
import json
from pathlib import Path

def main():
    """Sync the version in package.json from ../fviewer/__init__.py"""
    frontend_dir = Path(__file__).parent

    # =========================================================
    # Sync version from __init__.py to package.json
    # =========================================================
    init_path = frontend_dir / "../fviewer/__init__.py"
    pkg_json_path = frontend_dir / "package.json"

    try:
        # 1. Read __version__ from __init__.py
        with open(init_path, "r") as f:
            match = re.search(
                r'__version__\s*=\s*[\'"]([^\'"]+)[\'"]', f.read())
            py_version = match.group(1) if match else "0.1.0"

        # 2. Inject it into package.json
        with open(pkg_json_path, "r") as f:
            pkg_data = json.load(f)

        if pkg_data.get("version") != py_version:
            print(f"--- Syncing package.json version to {py_version} ---")
            pkg_data["version"] = py_version
            with open(pkg_json_path, "w") as f:
                json.dump(pkg_data, f, indent=2)
                f.write("\n")  # Add trailing newline
    except Exception as e:
            print(f"--- Warning: Could not sync versions: {e} ---")
        # =========================================================

if __name__ == '__main__':
    main()