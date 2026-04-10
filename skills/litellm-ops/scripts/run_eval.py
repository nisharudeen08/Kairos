#!/usr/bin/env python3
"""
Run all evals for ide-extension-engineer skill.
Saves per-eval outputs and a summary results.json.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from utils import (
    SKILL_ROOT, RESULTS_PATH,
    load_evals, run_claude_with_skill,
    save_output, check_expectations, print_eval_result,
)


def main() -> int:
    try:
        evals = load_evals()
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    print(f"Running {len(evals)} evals for ide-extension-engineer...\n")

    results = []
    for ev in evals:
        print(f"[{ev['id']}] {ev['prompt'][:70]}...")

        try:
            output = run_claude_with_skill(ev["prompt"])
        except Exception as e:
            print(f"  ✗ ERROR: {e}\n")
            results.append({
                "id": ev["id"],
                "prompt": ev["prompt"],
                "output": f"ERROR: {e}",
                "pass_rate": 0.0,
                "checks": [],
            })
            continue

        save_output(ev["id"], output)
        checks = check_expectations(output, ev.get("expectations", []))
        print_eval_result(ev["id"], ev["prompt"], checks)
        print()

        passed = sum(1 for c in checks if c["passed"])
        total = len(checks)

        results.append({
            "id": ev["id"],
            "category": ev.get("category", "unspecified"),
            "prompt": ev["prompt"],
            "output": output,
            "pass_rate": passed / total if total else 1.0,
            "checks": checks,
        })

    overall = sum(r["pass_rate"] for r in results) / len(results) if results else 0.0

    print("─" * 50)
    print(f"Overall pass rate: {overall:.1%}  ({sum(1 for r in results if r['pass_rate'] == 1.0)}/{len(results)} fully passing)")

    # Save results
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "skill_name": "ide-extension-engineer",
        "run_at": datetime.now().isoformat(),
        "overall": overall,
        "results": results,
    }
    RESULTS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Results saved → {RESULTS_PATH}")

    return 0 if overall >= 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
