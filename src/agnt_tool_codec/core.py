"""Pure Python implementation of the AGNT Tool Codec scoring contract.

The core is intentionally dependency-free so it can be embedded in agent
frameworks without bringing in AGNT, Node.js, or a database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from pathlib import Path
from typing import Any, Iterable


STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "have",
    "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "need", "to", "of", "in", "for", "on",
    "with", "at", "by", "from", "as", "into", "through", "during", "before",
    "after", "above", "below", "between", "out", "off", "over", "under",
    "again", "further", "then", "once", "here", "there", "when", "where",
    "why", "how", "all", "each", "every", "both", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "because", "but", "and", "or",
    "if", "while", "about", "up", "that", "this", "these", "those", "what",
    "which", "who", "whom", "its", "our", "also", "want", "like", "make",
    "know", "time", "come", "back", "much", "show", "tell", "give", "run",
}


DEFAULT_CONFIG: dict[str, Any] = {
    "version": "1.1.0",
    "maxTools": 7,
    "minThreshold": 0.15,
    "tokenBudget": 8700,
    "toolTokenEstimate": 1200,
    "keywordWeight": 0.5,
    "rawKeywordWeight": 0.08,
    "rawKeywordCap": 0.3,
    "domainBoost": 0.15,
    "intentBoost": 0.2,
    "descriptionWeight": 0.3,
    "titleBoost": 0.1,
    "pluginBoost": 0.05,
    "fallbackTools": ["execute_javascript_code", "web_search", "file_operations"],
    "intentPatterns": {
        "monitor": ["check", "status", "health", "monitor", "watch", "track", "observe", "survey", "inspect", "diagnose", "alert", "coherence", "drift", "anomaly"],
        "create": ["create", "build", "make", "generate", "write", "compose", "design", "forge", "craft", "spawn", "implement", "develop"],
        "search": ["find", "search", "look", "locate", "discover", "query", "fetch", "retrieve", "get", "list", "browse", "explore"],
        "analyze": ["analyze", "evaluate", "assess", "review", "study", "examine", "investigate", "benchmark", "compare", "profile", "measure"],
        "fix": ["fix", "repair", "resolve", "debug", "patch", "correct", "heal", "restore", "remediate", "troubleshoot"],
        "deploy": ["deploy", "release", "publish", "push", "ship", "launch", "install", "activate", "submit"],
        "configure": ["configure", "setup", "set", "update", "change", "modify", "adjust", "tune", "optimize", "enable", "disable"],
    },
    "domains": {
        "system": ["scm", "health", "monitor", "scheduler", "workflow", "execution", "coherence", "ecosystem", "state", "status", "plugin", "plugins", "tools"],
        "finance": ["credit", "burn", "wallet", "balance", "transaction", "cost", "bitcoin", "price", "fee", "bank", "trading"],
        "development": ["code", "git", "github", "build", "test", "deploy", "ci", "neural", "model", "train", "api"],
        "data": ["analyze", "query", "search", "index", "corpus", "dataset", "benchmark", "spreadsheet", "database"],
        "communication": ["discord", "slack", "email", "telegram", "message", "notify", "send", "chat", "conversation"],
        "science": ["chemistry", "phi", "math", "validate", "synthesize", "reaction", "fibonacci", "ratio", "molecule"],
    },
}


WORD_RE = re.compile(r"[\s\-_,.()[\]{}:/\\]+")


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _merge_config(config: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(DEFAULT_CONFIG)
    if config:
        for key, value in config.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                next_value = dict(merged[key])
                next_value.update(value)
                merged[key] = next_value
            else:
                merged[key] = value
    return merged


def _words(text: str) -> list[str]:
    return [word for word in WORD_RE.split(text.lower()) if len(word) > 2]


def encode_intent(message: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = _merge_config(config)
    lower = message.lower()
    raw_words = _words(lower)

    primary_intent = "general"
    intent_score = 0
    for intent, keywords in cfg["intentPatterns"].items():
        matches = sum(1 for keyword in keywords if keyword in lower)
        if matches > intent_score:
            intent_score = matches
            primary_intent = intent

    first_word = raw_words[0] if raw_words else None
    for intent, keywords in cfg["intentPatterns"].items():
        if first_word in keywords:
            primary_intent = intent
            break

    primary_domain = "general"
    domain_score = 0
    for domain, keywords in cfg["domains"].items():
        matches = sum(1 for keyword in keywords if keyword in lower)
        if matches > domain_score:
            domain_score = matches
            primary_domain = domain

    if (
        any(word in {"plugin", "plugins"} for word in raw_words)
        and primary_intent in {"create", "deploy", "configure"}
    ):
        primary_domain = "development"

    return {
        "primaryIntent": primary_intent,
        "primaryDomain": primary_domain,
        "keywords": [word for word in raw_words if word not in STOPWORDS],
        "rawKeywords": raw_words,
        "raw": message,
    }


def _tool_words(value: Any) -> list[str]:
    if isinstance(value, str):
        return _words(value)
    if isinstance(value, Iterable):
        return [str(item).lower() for item in value if item is not None]
    return []


def _name(tool: dict[str, Any]) -> str:
    return str(tool.get("name") or tool.get("tool") or "")


def score_tools(
    intent: dict[str, Any],
    tools: Iterable[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    cfg = _merge_config(config)
    results: list[dict[str, Any]] = []

    for tool in tools:
        name = _name(tool)
        if not name:
            continue

        score = 0.0
        rationale: list[str] = []
        tool_keywords = set(_tool_words(tool.get("keywords", [])))
        intent_keywords = intent.get("keywords", [])
        raw_keywords = intent.get("rawKeywords", [])

        overlap = [word for word in intent_keywords if word in tool_keywords]
        if overlap:
            score += (len(overlap) / max(len(intent_keywords), 1)) * cfg["keywordWeight"]
            rationale.extend(f"kw:{word}" for word in overlap[:3])

        raw_overlap = [word for word in raw_keywords if word in tool_keywords]
        if len(raw_overlap) > len(overlap):
            score += min((len(raw_overlap) - len(overlap)) * cfg["rawKeywordWeight"], cfg["rawKeywordCap"])

        if tool.get("domain") == intent.get("primaryDomain") and intent.get("primaryDomain") != "general":
            score += cfg["domainBoost"]
            rationale.append(f"dom:{intent['primaryDomain']}")

        if intent.get("primaryIntent") != "general" and intent.get("primaryIntent") in tool.get("intents", []):
            score += cfg["intentBoost"]
            rationale.append(f"int:{intent['primaryIntent']}")

        description_words = set(_tool_words(tool.get("description", "")))
        desc_overlap = [word for word in raw_keywords if word in description_words]
        if desc_overlap:
            score += min((len(desc_overlap) / max(len(description_words), 1)) * cfg["descriptionWeight"], cfg["descriptionWeight"])
            rationale.extend(f"d:{word}" for word in desc_overlap[:2])

        title_overlap = [word for word in raw_keywords if word in set(_tool_words(tool.get("title", "")))]
        if title_overlap:
            score += cfg["titleBoost"] * len(title_overlap)
            rationale.append(f"title:{title_overlap[0]}")

        plugin_overlap = [word for word in raw_keywords if word in set(_tool_words(tool.get("plugin", "")))]
        if plugin_overlap:
            score += cfg["pluginBoost"] * len(plugin_overlap)

        score = min(score, 1.0)
        if score >= cfg["minThreshold"]:
            results.append({
                "tool": name,
                "score": round(score, 3),
                "rationale": rationale[:5],
                "domain": tool.get("domain", "general"),
                "category": tool.get("category", "general"),
                "plugin": tool.get("plugin", "native"),
                "title": tool.get("title", name),
            })

    results.sort(key=lambda item: item["score"], reverse=True)
    return results


def select_tools(
    message: str,
    tools: Iterable[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    cfg = _merge_config(config)
    tool_list = list(tools)
    intent = encode_intent(message, cfg)
    ranked = score_tools(intent, tool_list, cfg)[: int(cfg["maxTools"])]
    selected_names = {item["tool"] for item in ranked}
    tool_names = {_name(tool) for tool in tool_list if _name(tool)}
    fallbacks = [
        name for name in cfg["fallbackTools"]
        if name not in selected_names and name in tool_names
    ]
    per_tool = int(cfg.get("toolTokenEstimate", 1200))
    static_tokens = len(tool_list) * per_tool
    dynamic_tokens = len(ranked) * per_tool

    return {
        "selected": ranked,
        "fallbacks": fallbacks,
        "intent": intent,
        "metadata": {
            "totalSelected": len(ranked),
            "tokenEstimate": dynamic_tokens,
            "staticTokenEstimate": static_tokens,
            "budget": cfg["tokenBudget"],
            "withinBudget": dynamic_tokens <= cfg["tokenBudget"],
            "savingsPercent": round((1 - dynamic_tokens / static_tokens) * 100) if static_tokens else 0,
        },
    }


@dataclass
class ToolCodec:
    tools: list[dict[str, Any]]
    config: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_files(cls, index_path: str | Path, config_path: str | Path | None = None) -> "ToolCodec":
        index = load_json(index_path)
        config = load_json(config_path) if config_path else {}
        return cls(tools=list(index.get("tools", [])), config=config)

    def select(self, message: str) -> dict[str, Any]:
        return select_tools(message, self.tools, self.config)
