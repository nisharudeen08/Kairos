#!/usr/bin/env python3
"""
Optimise the SKILL.md description to maximise triggering accuracy.
Tests each candidate description against POSITIVE and NEGATIVE trigger phrases.

Usage:
  python scripts/improve_description.py
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from utils import run_claude, SKILL_ROOT

SKILL_MD = SKILL_ROOT / "SKILL.md"

# ─── Triggers ─────────────────────────────────────────────────────────────────

# Prompts that SHOULD activate this skill
POSITIVE_TRIGGERS = [
    "Build me a VS Code extension with a chat sidebar",
    "Create a JetBrains plugin with a tool window",
    "Scaffold an Antigravity skill for code review",
    "Fix my ChatViewProvider, the webview is blank",
    "Add a model selector to my VS Code extension",
    "Debug my JetBrains plugin, it freezes the IDE",
    "How do I register a tool window in plugin.xml?",
    "Write a WebviewViewProvider for my VS Code sidebar",
    "Create a new JetBrains action for my plugin",
    "Ship my VS Code extension to the marketplace",
]

# Prompts that should NOT activate this skill
NEGATIVE_TRIGGERS = [
    "Write a Python script to parse CSV files",
    "Help me debug this SQL query",
    "Explain how React hooks work",
    "Write a unit test for this function",
    "How do I centre a div in CSS?",
    "Draft an email to my team about the meeting",
    "What is the capital of France?",
    "Help me configure nginx",
    "Write a bash script to backup my files",
]


# ─── Scoring ──────────────────────────────────────────────────────────────────

def get_current_description() -> str:
    """Extract description from SKILL.md frontmatter."""
    content = SKILL_MD.read_text(encoding="utf-8")
    match = re.search(r"description:\s*>\s*\n(.*?)(?=\n\w|\n---)", content, re.DOTALL)
    if match:
        return "\n".join(
            line.strip() for line in match.group(1).splitlines()
            if line.strip()
        )
    return ""


def test_trigger(prompt: str, description: str, should_trigger: bool) -> tuple[bool, str]:
    """Ask Claude if it would use this skill given the description."""
    judge_prompt = (
        f"You are deciding whether to use a specific skill tool.\n\n"
        f"Skill description:\n{description}\n\n"
        f"User request: {prompt}\n\n"
        f"Would you use this skill for this request? "
        f"Answer with exactly one word: YES or NO."
    )
    try:
        result = run_claude(judge_prompt)
        triggered = "yes" in result.strip().lower()
        correct = triggered == should_trigger
        label = "✓" if correct else "✗"
        expected = "TRIGGER" if should_trigger else "SKIP"
        got = "triggered" if triggered else "skipped"
        return correct, f"{label} [{expected}→{got}] {prompt[:60]}"
    except Exception as e:
        return False, f"✗ [ERROR] {e} — {prompt[:60]}"


def score_description(description: str, verbose: bool = False) -> float:
    """Score a description. Returns 0.0–1.0."""
    correct = 0
    total = len(POSITIVE_TRIGGERS) + len(NEGATIVE_TRIGGERS)

    if verbose:
        print("  Positive triggers:")
    for p in POSITIVE_TRIGGERS:
        ok, msg = test_trigger(p, description, should_trigger=True)
        if ok:
            correct += 1
        if verbose:
            print(f"    {msg}")

    if verbose:
        print("  Negative triggers:")
    for n in NEGATIVE_TRIGGERS:
        ok, msg = test_trigger(n, description, should_trigger=False)
        if ok:
            correct += 1
        if verbose:
            print(f"    {msg}")

    return correct / total if total else 1.0


def generate_improved_description(current: str, score: float) -> str:
    """Ask Claude to produce a better description."""
    prompt = (
        f"The following is a skill description for an IDE extension engineering skill.\n"
        f"It scored {score:.1%} on a triggering accuracy test.\n\n"
        f"Current description:\n{current}\n\n"
        f"Improve this description to score higher. Rules:\n"
        f"- Start with an action verb\n"
        f"- Name 3–5 specific sub-tasks\n"
        f"- Include 'Use this skill whenever' conditions\n"
        f"- List 5–8 trigger phrases in quotes\n"
        f"- End with 'Always use this skill when X — do not attempt without it'\n"
        f"- Max 120 words total\n\n"
        f"Return ONLY the improved description text, no YAML, no quotes, no explanation."
    )
    return run_claude(prompt).strip()


def replace_description(new_desc: str) -> None:
    """Replace the description in SKILL.md."""
    content = SKILL_MD.read_text(encoding="utf-8")
    # Indent for YAML block scalar
    indented = "\n".join(f"  {line}" for line in new_desc.splitlines())
    new_block = f"description: >\n{indented}\n"
    updated = re.sub(
        r"description:\s*>\s*\n.*?(?=\n\w|\n---)",
        new_block,
        content,
        flags=re.DOTALL,
    )
    SKILL_MD.write_text(updated, encoding="utf-8")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not POSITIVE_TRIGGERS:
        print("Add POSITIVE_TRIGGERS to enable scoring.")
        return

    print("Scoring current description...")
    current = get_current_description()
    if not current:
        print("ERROR: Could not extract description from SKILL.md")
        sys.exit(1)

    print(f"Current description ({len(current.split())} words):\n")
    print(current[:300], "..." if len(current) > 300 else "")
    print()

    score = score_description(current, verbose=True)
    print(f"\nCurrent score: {score:.1%}")

    if score >= 0.90:
        print("✓ Already above 90% — no improvement needed.")
        return

    print("\nGenerating improved description...")
    improved = generate_improved_description(current, score)
    print(f"\nProposed description:\n{improved}\n")

    new_score = score_description(improved, verbose=False)
    print(f"Proposed score: {new_score:.1%}  (was {score:.1%})")

    if new_score > score:
        replace_description(improved)
        print("✓ SKILL.md description updated.")
    else:
        print("✗ Improved description did not score better. Not applied.")
        print("  Run again to try a different variant.")


if __name__ == "__main__":
    main()
