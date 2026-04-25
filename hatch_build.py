import os
import re
import json
import shutil
import subprocess
from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if self.target_name == "editable":
            print("--- Skipping frontend build for editable install ---")
            return

        frontend_dir = os.path.join(self.root, "frontend")
        static_dir = os.path.join(self.root, "fviewer", "static")
        index_file = os.path.join(static_dir, "index.html")

        frontend_dir = os.path.join(self.root, "frontend")
        static_dir = os.path.join(self.root, "fviewer", "static")

        # =========================================================
        # Sync version from __init__.py to package.json
        # =========================================================
        init_path = os.path.join(self.root, "fviewer", "__init__.py")
        pkg_json_path = os.path.join(frontend_dir, "package.json")

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

        # 1. Check if NPM is installed
        if shutil.which("npm") is None:
            print("--- WARNING: 'npm' not found on this system ---")
            # 2. Check for cached files
            if os.path.exists(index_file):
                print(f"--- Using cached frontend build in {static_dir} ---")
                return
            else:
                raise RuntimeError(
                    "NPM is required to build the frontend, but it is "
                    "not installed "
                    f"and no cached build was found in {static_dir}."
                )

        # 3. If NPM is available, do the full build
        print(f"--- Building frontend for {self.target_name} ---")
        subprocess.run(
            "npm install", cwd=frontend_dir, check=True, shell=True)
        subprocess.run(
            "npm run build", cwd=frontend_dir, check=True, shell=True)
