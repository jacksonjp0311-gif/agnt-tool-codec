"""Small deterministic eval runner for capability indexes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .core import ToolCodec


def run_eval(codec: ToolCodec, cases: list[dict[str, Any]]) -> dict[str, Any]:
    results = []
    top1 = 0
    top3 = 0
    covered = 0

    for case in cases:
        message = case["message"]
        expected = set(case.get("expected_tools", []))
        result = codec.select(message)
        selected = [item["tool"] for item in result["selected"]]
        hit_top1 = bool(selected and selected[0] in expected)
        hit_top3 = bool(expected & set(selected[:3]))
        hit_any = bool(expected & set(selected))
        top1 += int(hit_top1)
        top3 += int(hit_top3)
        covered += int(hit_any)
        results.append({
            "message": message,
            "expected": sorted(expected),
            "selected": selected,
            "top1": hit_top1,
            "top3": hit_top3,
            "covered": hit_any,
            "savingsPercent": result["metadata"]["savingsPercent"],
        })

    total = len(cases)
    return {
        "summary": {
            "cases": total,
            "top1": top1,
            "top1Rate": round(top1 / total, 3) if total else 0,
            "top3": top3,
            "top3Rate": round(top3 / total, 3) if total else 0,
            "covered": covered,
            "coveredRate": round(covered / total, 3) if total else 0,
        },
        "results": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate a capability index against labeled prompts.")
    parser.add_argument("--index", default="capability-index.json", help="Capability index JSON path.")
    parser.add_argument("--config", default="config.json", help="Config JSON path.")
    parser.add_argument("--cases", default="evals/demo-cases.json", help="Eval cases JSON path.")
    parser.add_argument("--json", action="store_true", help="Print full JSON output.")
    args = parser.parse_args(argv)

    codec = ToolCodec.from_files(args.index, args.config if Path(args.config).exists() else None)
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    report = run_eval(codec, cases)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        summary = report["summary"]
        print(
            f"cases={summary['cases']} "
            f"top1={summary['top1Rate']:.3f} "
            f"top3={summary['top3Rate']:.3f} "
            f"covered={summary['coveredRate']:.3f}"
        )
        for item in report["results"]:
            status = "OK" if item["covered"] else "MISS"
            print(f"{status} | {item['message']} -> {', '.join(item['selected'][:3])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
