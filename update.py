#!/usr/bin/env python3
"""Update helper for Tibia Weekly Market Helper.
Preferred method: use this project as a Git clone and run: git pull --ff-only
This script does the same when .git exists.
"""
from pathlib import Path
import subprocess, sys

ROOT = Path(__file__).resolve().parent

def main():
    if not (ROOT / ".git").exists():
        print("This folder is not a Git clone.")
        print("Create/upload the project on GitHub, then install it with:")
        print("  git clone https://github.com/YOUR_USERNAME/tibia-weekly-market-helper.git")
        print("After that, update with:")
        print("  git pull --ff-only")
        return 1
    try:
        res = subprocess.run(["git", "pull", "--ff-only"], cwd=ROOT, text=True)
        if res.returncode == 0:
            print("Update complete. Restart server.py if it is running.")
        return res.returncode
    except FileNotFoundError:
        print("Git is not installed or not in PATH. Install Git for Windows first.")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
