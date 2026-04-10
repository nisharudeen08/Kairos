#!/usr/bin/env python3
"""
Package ide-extension-engineer for distribution.
Creates a versioned ZIP file in the parent directory.

Usage:
  python scripts/package_skill.py
"""

import sys
import zipfile
from datetime import datetime
from pathlib import Path

SKILL_ROOT = Path(__file__).parent.parent

INCLUDE_PATHS = [
    "SKILL.md",
    "agents/",
    "assets/",
    "references/",
    "scripts/",
    "eval-viewer/",
    "evals/evals.json",
]

EXCLUDE_PATTERNS = [
    "*.pyc",
    "__pycache__",
    "*.egg-info",
    "outputs/",
    "results*.json",
    "results_*.json",
    "SKILL_v*.md",
    "history.json",
    ".DS_Store",
    "Thumbs.db",
]


def should_exclude(path: Path) -> bool:
    """Return True if the file should be excluded from the package."""
    path_str = str(path)
    for pattern in EXCLUDE_PATTERNS:
        clean = pattern.rstrip("/")
        if path.match(pattern) or clean in path_str:
            return True
    return False


def collect_files() -> list[tuple[Path, str]]:
    """Collect (absolute_path, archive_name) pairs for all includable files."""
    skill_name = SKILL_ROOT.name
    files = []

    for include in INCLUDE_PATHS:
        full = SKILL_ROOT / include

        if full.is_file():
            if not should_exclude(full):
                archive_name = str(Path(skill_name) / include)
                files.append((full, archive_name))

        elif full.is_dir():
            for f in sorted(full.rglob("*")):
                if f.is_file() and not should_exclude(f):
                    rel = f.relative_to(SKILL_ROOT)
                    archive_name = str(Path(skill_name) / rel)
                    files.append((f, archive_name))

    return files


def main() -> None:
    version_tag = datetime.now().strftime("%Y%m%d_%H%M")
    out_name = f"{SKILL_ROOT.name}-{version_tag}.zip"
    out_path = SKILL_ROOT.parent / out_name

    files = collect_files()
    if not files:
        print("ERROR: No files to package.")
        sys.exit(1)

    print(f"Packaging {len(files)} files → {out_name}")

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for src, arc in files:
            zf.write(src, arc)
            print(f"  + {arc}")

    size_kb = out_path.stat().st_size / 1024
    print(f"\n✓ Packaged: {out_path}  ({size_kb:.1f} KB)")
    print(f"  Install: unzip {out_name} -d <skills-dir>/")


if __name__ == "__main__":
    main()
