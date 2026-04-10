#!/usr/bin/env python3
"""
Compare eval results across skill versions (v0, v1, v2...).
Reports which version has the best pass rate.

Usage:
  python scripts/aggregate_benchmark.py           # defaults: v0, v1, v2
  python scripts/aggregate_benchmark.py v0 v1 v3  # specify versions
"""

import json
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).parent.parent


def load_version_results(version: str) -> dict | None:
    """Load results for a specific version snapshot."""
    path = SKILL_ROOT / "evals" / f"results_{version}.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(versions: list[str]) -> None:
    print(f"\n{'Version':<10} {'Pass Rate':<12} {'Fully Passing':<16} {'Notes'}")
    print("─" * 55)

    best_version = None
    best_rate = -1.0
    rows = []

    for v in versions:
        data = load_version_results(v)
        if data is None:
            rows.append((v, None, None))
            continue
        rate = data.get("overall", 0.0)
        fully = sum(1 for r in data.get("results", []) if r.get("pass_rate", 0) == 1.0)
        total = len(data.get("results", []))
        rows.append((v, rate, f"{fully}/{total}"))
        if rate > best_rate:
            best_rate = rate
            best_version = v

    for v, rate, fully in rows:
        if rate is None:
            print(f"{v:<10} {'NOT FOUND':<12}")
        else:
            flag = " ← BEST" if v == best_version else ""
            print(f"{v:<10} {rate:.1%}{'':>6} {fully:<16}{flag}")

    print()
    if best_version:
        print(f"Best version: {best_version}  ({best_rate:.1%} pass rate)")
        print(f"Restore with: copy {SKILL_ROOT / f'SKILL_{best_version}.md'} {SKILL_ROOT / 'SKILL.md'}")
    else:
        print("No valid results found. Run scripts/run_eval.py first.")


if __name__ == "__main__":
    version_args = sys.argv[1:] if len(sys.argv) > 1 else ["v0", "v1", "v2"]
    main(version_args)
