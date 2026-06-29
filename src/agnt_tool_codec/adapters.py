"""Adapters for common agent tool formats.

These helpers keep the core codec independent from any one framework while
making it easy to use with OpenAI-style tool schemas and plain Python callables.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable, Iterable

from .core import _words, select_tools


DOMAIN_HINTS = {
    "development": {"git", "github", "code", "commit", "pull", "request", "deploy", "test", "shell", "python"},
    "data": {"search", "query", "database", "sql", "sheet", "csv", "json", "web", "scrape"},
    "communication": {"email", "slack", "discord", "message", "notify", "chat"},
    "finance": {"payment", "invoice", "balance", "transaction", "price", "wallet", "stripe"},
    "system": {"file", "health", "status", "monitor", "workflow", "agent", "tool", "memory"},
}

INTENT_HINTS = {
    "search": {"search", "find", "lookup", "query", "list", "fetch", "retrieve"},
    "create": {"create", "write", "send", "generate", "build", "make"},
    "analyze": {"analyze", "summarize", "compare", "inspect", "review", "evaluate"},
    "fix": {"fix", "debug", "repair", "resolve", "patch"},
    "deploy": {"deploy", "publish", "push", "release", "commit"},
    "monitor": {"monitor", "watch", "status", "health", "check"},
    "configure": {"configure", "update", "set", "change", "enable", "disable"},
}


def _infer_domain(words: set[str]) -> str:
    best = ("general", 0)
    for domain, hints in DOMAIN_HINTS.items():
        score = len(words & hints)
        if score > best[1]:
            best = (domain, score)
    return best[0]


def _infer_intents(words: set[str]) -> list[str]:
    intents = [intent for intent, hints in INTENT_HINTS.items() if words & hints]
    return intents or ["general"]


def _capability(name: str, description: str = "", *, title: str | None = None, category: str = "tool") -> dict[str, Any]:
    all_words = set(_words(f"{name} {title or ''} {description}"))
    return {
        "name": name,
        "plugin": "adapter",
        "title": title or name.replace("_", " ").replace("-", " ").title(),
        "category": category,
        "domain": _infer_domain(all_words),
        "intents": _infer_intents(all_words),
        "keywords": sorted(all_words)[:24],
        "description": description,
    }


def capability_from_openai_tool(tool: dict[str, Any]) -> dict[str, Any]:
    """Convert an OpenAI Chat/Responses tool schema into codec metadata."""

    function = tool.get("function", tool)
    name = function.get("name") or tool.get("name")
    if not name:
        raise ValueError("OpenAI tool is missing function.name")
    description = function.get("description") or tool.get("description") or ""
    return _capability(name, description, category="openai")


def capabilities_from_openai_tools(tools: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [capability_from_openai_tool(tool) for tool in tools]


def capability_from_callable(func: Callable[..., Any]) -> dict[str, Any]:
    """Convert a Python callable into codec metadata using its name and docstring."""

    name = getattr(func, "__name__", None)
    if not name:
        raise ValueError("callable is missing __name__")
    description = inspect.getdoc(func) or ""
    return _capability(name, description, category="python")


def filter_openai_tools(
    message: str,
    tools: Iterable[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return OpenAI tools filtered and ordered by codec selection.

    The second return value is the full codec result, including scores and
    rationale. Unknown or unselected tools are omitted.
    """

    tool_list = list(tools)
    capabilities = capabilities_from_openai_tools(tool_list)
    result = select_tools(message, capabilities, config)
    rank = {item["tool"]: index for index, item in enumerate(result["selected"])}

    def tool_name(tool: dict[str, Any]) -> str:
        return tool.get("function", tool).get("name") or tool.get("name") or ""

    filtered = [tool for tool in tool_list if tool_name(tool) in rank]
    filtered.sort(key=lambda tool: rank[tool_name(tool)])
    return filtered, result
