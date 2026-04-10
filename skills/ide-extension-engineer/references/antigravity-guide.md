# Antigravity Skill Guide

Deep-dive reference for building Antigravity agent skills (SKILL.md packages).
Read when creating, improving, or debugging Antigravity skill components.

---

## Table of Contents
1. [Skill Loading Mechanics](#1-skill-loading-mechanics)
2. [Description Engineering](#2-description-engineering)
3. [Agent Orchestration Patterns](#3-agent-orchestration-patterns)
4. [Eval Design Principles](#4-eval-design-principles)
5. [Script Architecture](#5-script-architecture)
6. [Improvement Loop Protocol](#6-improvement-loop-protocol)
7. [Common Pitfalls](#7-common-pitfalls)
8. [Quality Gate Checklist](#8-quality-gate-checklist)

---

## 1. Skill Loading Mechanics

Understanding what Kairos reads and when:

```
ALWAYS LOADED:
  SKILL.md frontmatter (name + description)
  → Used for skill selection / triggering

ON TRIGGER:
  SKILL.md full body
  → Instructions for execution

ON DEMAND (Claude reads when SKILL.md references them):
  agents/*.md
  references/*.md
  → Loaded by name when SKILL.md says "call agents/analyzer.md"

NEVER AUTO-LOADED:
  scripts/     → Executed as Python subprocesses
  assets/      → Served as files, not read into context
  evals/       → Used by scripts, not loaded into sessions
```

**Implication:** SKILL.md must be self-sufficient for simple tasks. Agents and
references should be referenced explicitly in the SKILL.md steps, not assumed.

---

## 2. Description Engineering

The description is the ONLY text Kairos reads to decide whether to activate a skill.

### Formula (mandatory structure):

```
[Action verb] [what skill does] — including [3-5 sub-tasks].
Use this skill whenever [trigger condition 1], [trigger condition 2],
or [trigger condition 3].
Triggers include: "[phrase 1]", "[phrase 2]", "[phrase 3]",
"[phrase 4]", "[phrase 5]".
Always use this skill when [key signal] — do not attempt [task] without this skill.
```

### Scoring rubric for descriptions:

| Criterion | Weight | Bad | Good |
|-----------|--------|-----|------|
| Action verb start | 10% | "Helps with..." | "Build, scaffold..." |
| Sub-tasks named | 20% | vague | 3-5 specific named tasks |
| "Use when" conditions | 20% | missing | 3+ specific conditions |
| Trigger phrases listed | 30% | none | 5-8 quoted phrases |
| Pushiness (do-not-attempt) | 10% | missing | present |
| Word count ≤ 120 | 10% | > 120 words | ≤ 120 words |

### Bad vs Good examples:

**BAD:**
```yaml
description: >
  Helps with writing code for extensions.
```
Problems: vague, no triggers, no "use when", no action verb specificity.

**GOOD:**
```yaml
description: >
  Build, scaffold, debug, and ship IDE extensions — including VS Code extensions
  (TypeScript, Webview, ChatViewProvider, commands), JetBrains plugins
  (Kotlin, tool windows, actions, services), and Antigravity agent skills.
  Use this skill whenever the user asks to build a VS Code extension,
  create a JetBrains plugin, or scaffold an Antigravity skill.
  Triggers include: "build a VS Code extension", "create a JetBrains plugin",
  "add a webview panel", "fix my ChatViewProvider", "scaffold a plugin",
  "build an Antigravity skill", "write a tool window".
  Always use this skill for IDE extension engineering — do not attempt
  plugin or extension creation without it.
```

---

## 3. Agent Orchestration Patterns

### Standard 3-agent flow (COMPLEX skills):

```
User request
    ↓
SKILL.md Step 0: "Call agents/analyzer.md to classify"
    ↓
analyzer.md → outputs classification block
    ↓
SKILL.md Step 2: "Call agents/planner.md with analyzer output"
    ↓
planner.md → outputs numbered execution plan
    ↓
SKILL.md Step 3: Execute plan (write code, documents, etc.)
    ↓
SKILL.md Step 4: "Call agents/reviewer.md to validate"
    ↓
reviewer.md → outputs APPROVED or NEEDS FIXES
    ↓
[If NEEDS FIXES: loop back, fix issues, re-review]
    ↓
Deliver output
```

### Domain agent pattern (optional 4th agent):

```
When SKILL.md Step 3 hits a domain-specific question
  (e.g. "which VS Code API to use for X"):
    ↓
"Call agents/ide-api.md with: [platform] [question]"
    ↓
ide-api.md → outputs code snippet + version gate + caveats
    ↓
Resume Step 3 with the resolved API pattern
```

### Agent data passing format:

Agents communicate through structured text blocks embedded in context.
Format output clearly with headers so the next agent can parse it:

```
ANALYZER OUTPUT
═══════════════════════
PLATFORM:  VS Code
TASK TYPE: DEBUG
COMPONENT: ChatViewProvider
...

[Next agent reads "ANALYZER OUTPUT" block as its input]
```

---

## 4. Eval Design Principles

### The 3 required eval types:

```
HAPPY PATH:
  - Normal, expected usage
  - Input is clean and valid
  - Output should be complete and correct
  Prompt example: "Write pytest tests for: def add(a,b): return a+b"

EDGE CASE:
  - Unusual but valid input
  - Empty input, minimal input, very large input
  - Output should gracefully handle it
  Prompt example: "Write tests for a function with no parameters"

ERROR CASE:
  - Bad input or impossible request
  - Output should be graceful (clear error, not crash)
  Prompt example: "Write tests for this file: [empty]"
```

### Writing good expectations:

```json
// WEAK expectations (avoid):
"expectations": [
  "Output is good",                    // not verifiable
  "Output contains code"               // too broad
]

// STRONG expectations:
"expectations": [
  "Output contains 'def test_'",       // specific substring
  "Output contains 'import pytest'",   // specific import
  "Output has at least 3 test functions",  // quantified
  "No syntax errors in Python output"  // structural check
]
```

### Eval coverage matrix:

| # | Category | Input type | Expected behaviour |
|---|----------|------------|-------------------|
| 1 | happy-path | Clean, normal | Full correct output |
| 2 | happy-path | Typical use | Correct with edge |
| 3 | edge-case | Empty/minimal | Graceful handling |
| 4 | edge-case | Large/complex | Still correct |
| 5 | error-case | Invalid input | Clear error message |
| 6 | regression | Previous bug | Fixed behaviour |
| 7+ | happy-path | More scenarios | Coverage |

---

## 5. Script Architecture

All 8 scripts and their responsibilities:

```
scripts/
├── __init__.py                 → Makes scripts/ a Python package
├── utils.py                   → SKILL_ROOT, load_evals(), run_claude(), save_output()
├── quick_validate.py          → Runs 2 smoke evals, exits 0/1
├── run_eval.py                → Runs all evals, saves results.json
├── aggregate_benchmark.py     → Compares v0/v1/v2 results, finds best
├── generate_report.py         → Renders results.json → HTML report
├── improve_description.py     → Scores and optimises SKILL.md description
├── run_loop.py                → Full iterative improvement loop (max 5 iterations)
└── package_skill.py           → Packages skill as distributable ZIP
```

### Script dependency chain:

```
utils.py (base)
  ↓ imported by
quick_validate.py → [1-2 evals] → exit 0/1
run_eval.py → [all evals] → evals/results.json
  ↓ reads
generate_report.py → assets/eval_review.html
  ↓ used by
eval-viewer/generate_review.py → eval-viewer/viewer.html
  ↓ compared by
aggregate_benchmark.py → reads results_v0.json, results_v1.json...
  ↓ orchestrated by
run_loop.py → [run_eval → improve → repeat], calls all above
  ↓ final output
package_skill.py → distributable .zip
```

---

## 6. Improvement Loop Protocol

When eval pass rate is below 90%:

```
1. Run: python scripts/run_eval.py
2. Check: evals/results.json — which evals failed?
3. Root cause by category:

   CORRECTNESS failures (<80%):
     → Fix SKILL.md step instructions
     → Make steps more explicit and imperative

   COMPLETENESS failures (<80%):
     → Add missing content to references/*.md
     → Add more examples to references/examples.md

   TRIGGERING failures (skill not activating):
     → Run: python scripts/improve_description.py
     → Add more trigger phrases to description
     → Make "use when" conditions more specific

   STRUCTURE failures (bad format output):
     → Fix agent files — tighten Output format specs
     → Add format examples to references/examples.md

   EVAL failures (evals too strict):
     → Relax expectations that are unreasonably specific
     → Split multi-check expectations into separate evals

4. Snapshot current version: copy SKILL.md → SKILL_v[n].md
5. Apply fix
6. Rerun: python scripts/run_eval.py
7. Compare: python scripts/aggregate_benchmark.py v0 v1
8. Keep best version
9. Repeat until ≥ 90% or user approves

STOP CONDITION:
  - Pass rate ≥ 90% (automated stop in run_loop.py)
  - User approves output (manual stop)
  - 5 iterations completed without improvement (automated stop)
```

---

## 7. Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Skill never activates | Description too vague | Add 5+ trigger phrases |
| Skill activates for wrong requests | Description too broad | Add "do NOT use for X" lines |
| Agents not loaded | SKILL.md doesn't reference them | Add "Call agents/X.md" to steps |
| Evals all pass but output is bad | Expectations too weak | Tighten expectation strings |
| Evals all fail but output looks right | Expectations too strict | Relax or split expectations |
| Scripts fail to import utils | Wrong sys.path | Add `sys.path.insert(0, scriptDir)` |
| run_loop.py hangs | run_claude() not implemented | Wire up actual Claude API call |
| Package too large | Including outputs/ in zip | Check EXCLUDE_PATTERNS in package_skill.py |

---

## 8. Quality Gate Checklist

Before declaring a skill complete:

```
SKILL.md:
  □ name + description frontmatter present
  □ Description follows formula (action verb, sub-tasks, use when, triggers, do-not-attempt)
  □ Description ≤ 120 words
  □ Steps are numbered with imperative verbs
  □ Steps reference agents/ and references/ explicitly
  □ Quality gates section at end

AGENTS (COMPLEX skills):
  □ analyzer.md — Role, Activation, Input, Process, Output, Rules
  □ planner.md  — same structure
  □ reviewer.md — same structure
  □ Domain agents if needed

REFERENCES:
  □ schemas.md — all data structures documented
  □ examples.md — 3+ worked input→process→output examples
  □ Domain guide if skill has domain-specific rules

EVALS:
  □ evals.json with 3+ cases
  □ Each eval: id, category, prompt, expected_output, expectations (2+)
  □ Categories: at least 1 happy-path, 1 edge-case, 1 error-case

SCRIPTS:
  □ All 8 files present and valid Python syntax
  □ utils.py: SKILL_ROOT, EVALS_PATH, load_evals(), run_claude()
  □ quick_validate.py: exits 0 on pass, 1 on fail
  □ run_loop.py: MAX_ITERS = 5, TARGET_RATE = 0.90

ASSETS:
  □ eval_review.html present (even if placeholder)

EVAL-VIEWER:
  □ viewer.html — loads results.json, filter + sort working
  □ generate_review.py — generates viewer.html from results
```
