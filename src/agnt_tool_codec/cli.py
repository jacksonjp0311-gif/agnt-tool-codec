"""Command line interface for the Python Tool Codec."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import ToolCodec


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rank agent tools by message intent.")
    parser.add_argument("message", nargs="*", help="User message to score.")
    parser.add_argument("--index", default="capability-index.json", help="Capability index JSON path.")
    parser.add_argument("--config", default="config.json", help="Optional config JSON path.")
    args = parser.parse_args(argv)

    message = " ".join(args.message).strip()
    if not message:
        parser.error("message is required")

    config_path = Path(args.config)
    codec = ToolCodec.from_files(args.index, config_path if config_path.exists() else None)
    print(json.dumps(codec.select(message), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
