# Copyright 2026, University of Maryland, All Rights Reserved

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
    app_file = frontend_dir / 'src/App.tsx'

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

        # 3. Update version number in App.tsx
        with open(app_file, "r") as f:
            app_content = f.read()
        updated_content = re.sub(
            r"(FViewer Version:\s*)[\d\.]+", 
            rf"\g<1>{py_version}", 
            app_content
        )
        with open(app_file, "w") as f:
            f.write(updated_content)

    except Exception as e:
        print(f"--- Warning: Could not sync versions: {e} ---")
        raise e
    # =========================================================

if __name__ == '__main__':
    main()