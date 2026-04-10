#!/usr/bin/env python3
"""
Generate interactive eval viewer.
Writes results to eval-viewer/viewer.html.

Usage:
  python eval-viewer/generate_review.py
"""

import sys
from pathlib import Path

# Add scripts/ to path so we can import generate_report
scripts_dir = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(scripts_dir))

import generate_report  # type: ignore

# Override OUTPUT_PATH to write to eval-viewer/viewer.html
generate_report.OUTPUT_PATH = Path(__file__).parent / "viewer.html"

if __name__ == "__main__":
    generate_report.main()
