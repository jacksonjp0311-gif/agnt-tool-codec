"""Command line interface for the Python Tool Codec."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from importlib.resources import files

from .core import ToolCodec


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rank agent tools by message intent.")
    parser.add_argument("message", nargs="*", help="User message to score.")
    parser.add_argument("--index", default="capability-index.json", help="Capability index JSON path.")
    parser.add_argument("--config", default="config.json", help="Optional config JSON path.")
    parser.add_argument("--demo", action="store_true", help="Use the built-in demo capability index.")
    parser.add_argument("--names", action="store_true", help="Print only selected tool names.")
    args = parser.parse_args(argv)

    message = " ".join(args.message).strip()
    if not message:
        parser.error("message is required")

    config_path = Path(args.config)
    index_path = files("agnt_tool_codec").joinpath("data/demo-index.json") if args.demo else Path(args.index)
    codec = ToolCodec.from_files(index_path, config_path if config_path.exists() else None)
    result = codec.select(message)
    if args.names:
        print("\n".join(item["tool"] for item in result["selected"]))
    else:
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
