"""Validation helpers for capability indexes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def validate_index(index: dict[str, Any]) -> list[str]:
    """Return human-readable validation errors for a capability index."""

    errors: list[str] = []
    if not isinstance(index, dict):
        return ["index must be a JSON object"]

    if not isinstance(index.get("version"), str) or not index.get("version"):
        errors.append("version must be a non-empty string")

    tools = index.get("tools")
    if not isinstance(tools, list):
        errors.append("tools must be a list")
        return errors

    seen: set[str] = set()
    for idx, tool in enumerate(tools):
        prefix = f"tools[{idx}]"
        if not isinstance(tool, dict):
            errors.append(f"{prefix} must be an object")
            continue

        name = tool.get("name") or tool.get("tool")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{prefix}.name must be a non-empty string")
        elif name in seen:
            errors.append(f"{prefix}.name duplicates {name!r}")
        else:
            seen.add(name)

        keywords = tool.get("keywords")
        if not isinstance(keywords, list) or not keywords:
            errors.append(f"{prefix}.keywords must be a non-empty list")
        elif not all(isinstance(item, str) and item.strip() for item in keywords):
            errors.append(f"{prefix}.keywords must contain non-empty strings")

        for field in ("intents",):
            value = tool.get(field)
            if value is not None and (
                not isinstance(value, list)
                or not all(isinstance(item, str) and item.strip() for item in value)
            ):
                errors.append(f"{prefix}.{field} must contain non-empty strings")

        for field in ("plugin", "title", "category", "domain", "description"):
            value = tool.get(field)
            if value is not None and not isinstance(value, str):
                errors.append(f"{prefix}.{field} must be a string")

    return errors


def validate_index_file(path: str | Path) -> list[str]:
    """Load and validate a capability index JSON file."""

    try:
        index = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        return [f"could not read index: {exc}"]
    except json.JSONDecodeError as exc:
        return [f"index is not valid JSON: {exc}"]
    return validate_index(index)
