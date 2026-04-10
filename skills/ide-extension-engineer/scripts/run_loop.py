#!/usr/bin/env python3
"""
Iterative improvement loop for ide-extension-engineer skill.
Runs evals, scores, rewrites SKILL.md, reruns. Keeps best version.
Stops when pass rate >= TARGET_RATE or MAX_ITERS reached.

Usage:
  python scripts/run_loop.py
"""

import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SKILL_ROOT    = Path(__file__).parent.parent
SKILL_MD      = SKILL_ROOT / "SKILL.md"
RESULTS_PATH  = SKILL_ROOT / "evals" / "results.json"
HISTORY_FILE  = SKILL_ROOT / "history.json"

MAX_ITERS   = 5
TARGET_RATE = 0.90


# ─── History ──────────────────────────────────────────────────────────────────

def load_history() -> dict:
    if HISTORY_FILE.exists():
        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {
        "started_at": datetime.now().isoformat(),
        "skill_name": SKILL_ROOT.name,
        "target_rate": TARGET_RATE,
        "max_iters": MAX_ITERS,
        "current_best": None,
        "iterations": [],
    }


def save_history(h: dict) -> None:
    HISTORY_FILE.write_text(json.dumps(h, indent=2), encoding="utf-8")


# ─── Version management ───────────────────────────────────────────────────────

def snapshot_skill(version: str) -> None:
    """Save a copy of SKILL.md as SKILL_v[n].md."""
    dest = SKILL_ROOT / f"SKILL_{version}.md"
    shutil.copy(SKILL_MD, dest)
    print(f"  Snapshot: {dest.name}")


def snapshot_results(version: str) -> None:
    """Save a copy of results.json as results_v[n].json."""
    if RESULTS_PATH.exists():
        dest = SKILL_ROOT / "evals" / f"results_{version}.json"
        shutil.copy(RESULTS_PATH, dest)


def restore_best(version: str) -> None:
    snapshot = SKILL_ROOT / f"SKILL_{version}.md"
    if snapshot.exists():
        shutil.copy(snapshot, SKILL_MD)
        print(f"✓ Restored {snapshot.name} → SKILL.md")
    else:
        print(f"WARNING: Could not find {snapshot.name} to restore.")


# ─── Eval runner ──────────────────────────────────────────────────────────────

def run_evals() -> float:
    """Run run_eval.py subprocess and return overall pass rate."""
    scripts_dir = SKILL_ROOT / "scripts"
    result = subprocess.run(
        [sys.executable, str(scripts_dir / "run_eval.py")],
        capture_output=True,
        text=True,
    )
    print(result.stdout.rstrip())
    if result.returncode not in (0, 1):
        print(f"WARNING: run_eval.py returned code {result.returncode}")
        if result.stderr:
            print(result.stderr[:300])

    # Parse pass rate from output line
    for line in result.stdout.splitlines():
        if "Overall pass rate:" in line:
            try:
                pct_str = line.split(":")[1].strip().split()[0].rstrip("%")
                return float(pct_str) / 100
            except (IndexError, ValueError):
                pass

    # Fall back to reading results.json directly
    if RESULTS_PATH.exists():
        with open(RESULTS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("overall", 0.0)

    return 0.0


# ─── Skill improvement ────────────────────────────────────────────────────────

def improve_skill(current_rate: float) -> None:
    """
    Ask Claude to rewrite SKILL.md based on failing evals.
    Requires the anthropic package and ANTHROPIC_API_KEY.
    """
    sys.path.insert(0, str(SKILL_ROOT / "scripts"))
    from utils import run_claude  # type: ignore

    # Load failing evals
    if not RESULTS_PATH.exists():
        print("  No results.json to improve from.")
        return

    with open(RESULTS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    failing = [r for r in data.get("results", []) if r.get("pass_rate", 1.0) < 1.0]
    fail_summary = "\n\n".join(
        f"Eval [{r['id']}]: {r['prompt']}\n"
        + "\n".join(
            f"  {'✗' if not c['passed'] else '✓'} {c['expectation']}"
            for c in r.get("checks", [])
        )
        for r in failing[:5]  # limit to 5 failures
    )

    current_skill = SKILL_MD.read_text(encoding="utf-8")

    prompt = (
        f"The ide-extension-engineer SKILL.md achieved {current_rate:.1%} on its evals.\n\n"
        f"Failing evals:\n{fail_summary}\n\n"
        f"Current SKILL.md:\n{current_skill}\n\n"
        f"Rewrite the SKILL.md to fix the failing evals. "
        f"Keep passing evals passing. Maintain the YAML frontmatter. "
        f"Return ONLY the new SKILL.md content — no explanation, no code fences."
    )

    print("  Calling Claude to improve SKILL.md...")
    try:
        new_skill = run_claude(prompt)
        SKILL_MD.write_text(new_skill, encoding="utf-8")
        print("  ✓ SKILL.md rewritten.")
    except Exception as e:
        print(f"  ✗ Improvement failed: {e}")


# ─── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"\n{'═' * 50}")
    print(f"  ide-extension-engineer — Improvement Loop")
    print(f"  Target: {TARGET_RATE:.0%}  |  Max iterations: {MAX_ITERS}")
    print(f"{'═' * 50}\n")

    history = load_history()
    best_rate = 0.0
    best_version = "v0"

    for i in range(MAX_ITERS):
        version = f"v{i}"
        print(f"\n── Iteration {version} {'─' * 30}")

        snapshot_skill(version)
        rate = run_evals()
        snapshot_results(version)

        print(f"\n  Pass rate: {rate:.1%}")

        won = rate > best_rate
        history["iterations"].append({
            "version": version,
            "parent": f"v{i - 1}" if i > 0 else None,
            "pass_rate": rate,
            "is_best": won,
            "timestamp": datetime.now().isoformat(),
        })

        if won:
            best_rate = rate
            best_version = version
            history["current_best"] = version
            for it in history["iterations"][:-1]:
                it["is_best"] = False

        save_history(history)

        if rate >= TARGET_RATE:
            print(f"\n✓ Target {TARGET_RATE:.0%} reached at {version}. Stopping.")
            break

        if i < MAX_ITERS - 1:
            print(f"\n  Improving skill (rate={rate:.1%} < target={TARGET_RATE:.0%})...")
            improve_skill(rate)
        else:
            print("\n  Max iterations reached.")

    print(f"\n{'═' * 50}")
    print(f"  Best version: {best_version}  ({best_rate:.1%})")
    restore_best(best_version)
    print(f"{'═' * 50}\n")

    # Generate final report
    try:
        subprocess.run(
            [sys.executable, str(SKILL_ROOT / "scripts" / "generate_report.py")],
            check=True,
        )
    except subprocess.CalledProcessError:
        print("WARNING: generate_report.py failed. Check results.json.")


if __name__ == "__main__":
    main()
