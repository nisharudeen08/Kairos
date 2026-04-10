#!/usr/bin/env python3
"""
Quick smoke test for ide-extension-engineer skill.
Runs 2 evals. Exits 0 on pass, 1 on fail.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from utils import load_evals, run_claude_with_skill, check_expectations, print_eval_result

SMOKE_IDS = [1, 2]  # First two evals only


def main() -> int:
    try:
        evals = {e["id"]: e for e in load_evals()}
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    passed_count = 0

    for eid in SMOKE_IDS:
        ev = evals.get(eid)
        if not ev:
            print(f"  [SKIP] Eval {eid} not found in evals.json")
            continue

        print(f"\nSmoke test [{eid}]: {ev['prompt'][:70]}...")

        try:
            output = run_claude_with_skill(ev["prompt"])
        except Exception as e:
            print(f"  ✗ ERROR calling Claude: {e}")
            continue

        checks = check_expectations(output, ev.get("expectations", []))
        print_eval_result(eid, ev["prompt"], checks)

        if all(c["passed"] for c in checks):
            passed_count += 1

    total = min(len(SMOKE_IDS), len(evals))
    print(f"\n{'─' * 40}")
    print(f"Smoke tests: {passed_count}/{total} passed")

    return 0 if passed_count == total else 1


if __name__ == "__main__":
    sys.exit(main())
