#!/usr/bin/env python3
"""
Generate an HTML eval report from evals/results.json.
Writes output to assets/eval_review.html.

Usage:
  python scripts/generate_report.py
"""

import json
import sys
from datetime import datetime
from pathlib import Path

SKILL_ROOT   = Path(__file__).parent.parent
RESULTS_PATH = SKILL_ROOT / "evals" / "results.json"
OUTPUT_PATH  = SKILL_ROOT / "assets" / "eval_review.html"

# Override OUTPUT_PATH before calling main() to redirect output
# (used by eval-viewer/generate_review.py)

HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eval Report — {skill_name}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: 'Segoe UI', system-ui, monospace;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 2em;
    }}
    h1 {{ color: #58a6ff; margin-top: 0; }}
    .meta {{ color: #8b949e; font-size: 0.85em; margin-bottom: 1.5em; }}
    .summary {{
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2em 1.5em;
      margin-bottom: 1.5em;
      display: flex;
      align-items: center;
      gap: 2em;
    }}
    .rate {{ font-size: 2.5em; font-weight: bold; }}
    .pass {{ color: #3fb950; }}
    .fail {{ color: #f85149; }}
    .card {{
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1em 1.2em;
      margin-bottom: 0.75em;
    }}
    .card.all-pass {{ border-left: 3px solid #3fb950; }}
    .card.some-fail {{ border-left: 3px solid #f85149; }}
    .card-header {{
      font-weight: 600;
      margin-bottom: 0.5em;
      display: flex;
      align-items: baseline;
      gap: 0.5em;
    }}
    .card-id {{ color: #58a6ff; font-size: 0.85em; }}
    .card-category {{
      font-size: 0.75em;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 0.1em 0.4em;
      color: #8b949e;
    }}
    .check {{
      display: flex;
      align-items: flex-start;
      gap: 0.4em;
      font-size: 0.82em;
      margin: 0.2em 0;
      color: #8b949e;
    }}
    .check.pass-check {{ color: #3fb950; }}
    .check.fail-check {{ color: #f85149; }}
    .output-toggle {{
      margin-top: 0.6em;
      font-size: 0.8em;
      color: #58a6ff;
      cursor: pointer;
      user-select: none;
    }}
    .output-box {{
      margin-top: 0.4em;
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 4px;
      padding: 0.6em;
      font-size: 0.78em;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 220px;
      overflow-y: auto;
      display: none;
    }}
    .output-box.visible {{ display: block; }}
  </style>
</head>
<body>
  <h1>📊 Eval Report — {skill_name}</h1>
  <div class="meta">Generated: {timestamp}</div>

  <div class="summary">
    <div class="rate {overall_class}">{overall_pct}%</div>
    <div>
      <div style="font-size:1.1em; font-weight:600;">Overall pass rate</div>
      <div style="color:#8b949e; font-size:0.9em;">{eval_count} evals · {fully_passing} fully passing</div>
    </div>
  </div>

  <div id="cards">
{cards}
  </div>

  <script>
    document.querySelectorAll('.output-toggle').forEach(toggle => {{
      toggle.addEventListener('click', () => {{
        const box = toggle.nextElementSibling;
        const showing = box.classList.toggle('visible');
        toggle.textContent = showing ? '▲ Hide output' : '▼ Show output';
      }});
    }});
  </script>
</body>
</html>
"""

CARD_TEMPLATE = """\
    <div class="card {card_class}">
      <div class="card-header">
        <span class="card-id">[{id}]</span>
        <span class="card-category">{category}</span>
        <span>{prompt}</span>
      </div>
      <div class="checks">
{checks_html}
      </div>
      <div class="output-toggle">▼ Show output</div>
      <div class="output-box">{output}</div>
    </div>
"""

CHECK_TEMPLATE = '        <div class="check {css}">{icon} {text}</div>'


def escape_html(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_card(r: dict) -> str:
    checks_html_parts = []
    for c in r.get("checks", []):
        css = "pass-check" if c["passed"] else "fail-check"
        icon = "✓" if c["passed"] else "✗"
        text = escape_html(c["expectation"][:120])
        checks_html_parts.append(CHECK_TEMPLATE.format(css=css, icon=icon, text=text))

    card_class = "all-pass" if r["pass_rate"] == 1.0 else "some-fail"
    return CARD_TEMPLATE.format(
        card_class=card_class,
        id=r["id"],
        category=escape_html(r.get("category", "")),
        prompt=escape_html(r["prompt"][:120]),
        checks_html="\n".join(checks_html_parts),
        output=escape_html((r.get("output") or "")[:2000]),
    )


def main() -> None:
    if not RESULTS_PATH.exists():
        print(f"ERROR: results.json not found at {RESULTS_PATH}")
        print("Run: python scripts/run_eval.py first.")
        sys.exit(1)

    with open(RESULTS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    overall = data.get("overall", 0.0)
    results = data.get("results", [])
    skill_name = data.get("skill_name", SKILL_ROOT.name)
    fully_passing = sum(1 for r in results if r.get("pass_rate", 0) == 1.0)

    cards = "\n".join(build_card(r) for r in results)

    html = HTML_TEMPLATE.format(
        skill_name=escape_html(skill_name),
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        overall_pct=f"{overall * 100:.0f}",
        overall_class="pass" if overall >= 0.8 else "fail",
        eval_count=len(results),
        fully_passing=fully_passing,
        cards=cards,
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(html, encoding="utf-8")
    print(f"Report saved → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
