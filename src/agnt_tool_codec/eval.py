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
    strict_top1 = 0
    strict_top3 = 0
    strict_covered = 0
    static_tokens = 0
    selected_tokens = 0

    for case in cases:
        message = case["message"]
        expected = set(case.get("expected_tools", []))
        acceptable = set(case.get("acceptable_tools", []))
        target = expected | acceptable
        result = codec.select(message)
        metadata = result["metadata"]
        selected = [item["tool"] for item in result["selected"]]
        strict_hit_top1 = bool(selected and selected[0] in expected)
        strict_hit_top3 = bool(expected & set(selected[:3]))
        strict_hit_any = bool(expected & set(selected))
        hit_top1 = bool(selected and selected[0] in target)
        hit_top3 = bool(target & set(selected[:3]))
        hit_any = bool(target & set(selected))
        strict_top1 += int(strict_hit_top1)
        strict_top3 += int(strict_hit_top3)
        strict_covered += int(strict_hit_any)
        top1 += int(hit_top1)
        top3 += int(hit_top3)
        covered += int(hit_any)
        static_tokens += metadata["staticTokenEstimate"]
        selected_tokens += metadata["tokenEstimate"]
        results.append({
            "message": message,
            "expected": sorted(expected),
            "acceptable": sorted(acceptable),
            "selected": selected,
            "strictTop1": strict_hit_top1,
            "strictTop3": strict_hit_top3,
            "strictCovered": strict_hit_any,
            "top1": hit_top1,
            "top3": hit_top3,
            "covered": hit_any,
            "staticTokenEstimate": metadata["staticTokenEstimate"],
            "selectedTokenEstimate": metadata["tokenEstimate"],
            "tokensSaved": metadata["staticTokenEstimate"] - metadata["tokenEstimate"],
            "savingsPercent": metadata["savingsPercent"],
        })

    total = len(cases)
    tokens_saved = static_tokens - selected_tokens
    return {
        "summary": {
            "cases": total,
            "top1": top1,
            "top1Rate": round(top1 / total, 3) if total else 0,
            "top3": top3,
            "top3Rate": round(top3 / total, 3) if total else 0,
            "covered": covered,
            "coveredRate": round(covered / total, 3) if total else 0,
            "strictTop1": strict_top1,
            "strictTop1Rate": round(strict_top1 / total, 3) if total else 0,
            "strictTop3": strict_top3,
            "strictTop3Rate": round(strict_top3 / total, 3) if total else 0,
            "strictCovered": strict_covered,
            "strictCoveredRate": round(strict_covered / total, 3) if total else 0,
            "staticTokenEstimate": static_tokens,
            "selectedTokenEstimate": selected_tokens,
            "tokensSaved": tokens_saved,
            "savingsRate": round(tokens_saved / static_tokens, 3) if static_tokens else 0,
            "averageStaticTokens": round(static_tokens / total) if total else 0,
            "averageSelectedTokens": round(selected_tokens / total) if total else 0,
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
            f"covered={summary['coveredRate']:.3f} "
            f"strict={summary['strictCoveredRate']:.3f} "
            f"savings={summary['savingsRate']:.3f} "
            f"tokens={summary['selectedTokenEstimate']}/{summary['staticTokenEstimate']}"
        )
        for item in report["results"]:
            status = "OK" if item["covered"] else "MISS"
            print(
                f"{status} | {item['message']} -> {', '.join(item['selected'][:3])} "
                f"| saved={item['tokensSaved']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
