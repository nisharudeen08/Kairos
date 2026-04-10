#!/usr/bin/env python3
"""Shared utilities for ide-extension-engineer skill scripts."""

import json
import os
import subprocess
import sys
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────

SKILL_ROOT   = Path(__file__).parent.parent
EVALS_PATH   = SKILL_ROOT / "evals" / "evals.json"
OUTPUTS_PATH = SKILL_ROOT / "evals" / "outputs"
RESULTS_PATH = SKILL_ROOT / "evals" / "results.json"


# ─── Eval Helpers ─────────────────────────────────────────────────────────────

def load_evals() -> list[dict]:
    """Load all eval cases from evals/evals.json."""
    if not EVALS_PATH.exists():
        raise FileNotFoundError(f"evals.json not found at: {EVALS_PATH}")
    with open(EVALS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("evals", [])


def save_output(eval_id: int, output: str) -> None:
    """Save raw model output for a given eval ID."""
    OUTPUTS_PATH.mkdir(parents=True, exist_ok=True)
    (OUTPUTS_PATH / f"{eval_id}.txt").write_text(output, encoding="utf-8")


def load_output(eval_id: int) -> str | None:
    """Load previously saved output for a given eval ID."""
    path = OUTPUTS_PATH / f"{eval_id}.txt"
    return path.read_text(encoding="utf-8") if path.exists() else None


def load_results() -> dict | None:
    """Load the most recent eval results."""
    if not RESULTS_PATH.exists():
        return None
    with open(RESULTS_PATH, encoding="utf-8") as f:
        return json.load(f)


# ─── Claude Integration ───────────────────────────────────────────────────────

def run_claude(prompt: str, system: str = "", model: str = "claude-3-5-sonnet-20241022") -> str:
    """
    Call Claude via the Anthropic API.

    Requires: pip install anthropic
    Requires: ANTHROPIC_API_KEY environment variable.

    To wire up a different LLM (LiteLLM, OpenAI, etc.), replace this function.
    """
    try:
        import anthropic  # type: ignore
    except ImportError:
        raise RuntimeError(
            "anthropic package not installed. Run: pip install anthropic\n"
            "Or replace run_claude() in utils.py with your own API client."
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY environment variable is not set.\n"
            "Set it with: $env:ANTHROPIC_API_KEY = 'sk-ant-...'"
        )

    client = anthropic.Anthropic(api_key=api_key)

    kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    message = client.messages.create(**kwargs)
    return message.content[0].text


def run_claude_with_skill(prompt: str) -> str:
    """
    Call Claude with the full SKILL.md loaded as system prompt.
    Used for evals that test the skill end-to-end.
    """
    skill_md = SKILL_ROOT / "SKILL.md"
    system = skill_md.read_text(encoding="utf-8") if skill_md.exists() else ""
    return run_claude(prompt, system=system)


# ─── Assertion Helpers ────────────────────────────────────────────────────────

def check_expectation(output: str, expectation: str) -> bool:
    """
    Check a single expectation against model output.
    Default: case-insensitive substring check.
    Override this function to add semantic checking.
    """
    # Strip leading check operators like "Output contains 'X'"
    # For now: simple substring match on the key phrase
    exp_lower = expectation.lower()
    out_lower = output.lower()

    # Extract quoted strings from "Output contains 'X'" style expectations
    import re
    quoted = re.findall(r"['\"](.+?)['\"]", expectation)
    if quoted:
        return all(q.lower() in out_lower for q in quoted)

    # Fall back to checking if first 50 chars of expectation appear in output
    return exp_lower[:50] in out_lower


def check_expectations(output: str, expectations: list[str]) -> list[dict]:
    """Check all expectations and return per-expectation results."""
    return [
        {
            "expectation": exp,
            "passed": check_expectation(output, exp),
        }
        for exp in expectations
    ]


# ─── Reporting ────────────────────────────────────────────────────────────────

def print_eval_result(eval_id: int, prompt: str, checks: list[dict]) -> None:
    """Pretty-print a single eval result."""
    passed = sum(1 for c in checks if c["passed"])
    total = len(checks)
    icon = "✓" if passed == total else "✗"
    print(f"  [{eval_id}] {icon} {passed}/{total}  {prompt[:70]}")
    for c in checks:
        mark = "    ✓" if c["passed"] else "    ✗"
        print(f"{mark} {c['expectation'][:80]}")


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Skill root: {SKILL_ROOT}")
    print(f"Evals path: {EVALS_PATH} ({'exists' if EVALS_PATH.exists() else 'MISSING'})")
    evals = load_evals()
    print(f"Loaded {len(evals)} eval cases.")
