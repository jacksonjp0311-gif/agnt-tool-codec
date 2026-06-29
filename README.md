# AGNT Tool Codec

Intent-aware tool selection for agent runtimes.

AGNT Tool Codec reads a user message, scores your available tools, and returns a small ranked shortlist. Instead of sending every tool schema to the model on every turn, your agent can send only the tools that are likely to matter.

```text
User message
    |
    v
+-----------+      +-------------+      +------------+
|  Encode   | ---> |    Score    | ---> |  Select    |
| intent    |      | tool fit    |      | top tools  |
+-----------+      +-------------+      +------------+
    |                    |                    |
    v                    v                    v
intent/domain       confidence +         compact tool
keywords            rationale            schema set
```

## Why This Exists

Modern agents accumulate tools quickly: web search, file access, code execution, memory, GitHub, databases, calendars, payments, internal APIs, and custom plugins. Passing all of those schemas into every model call is expensive and noisy.

The codec gives the orchestration layer a simple preflight step:

```python
result = codec.select("push these changes to GitHub")
```

Result:

```json
{
  "selected": [
    { "tool": "github-plugin", "score": 0.821 },
    { "tool": "execute-javascript-code", "score": 0.15 }
  ],
  "metadata": {
    "tokenEstimate": 8400,
    "withinBudget": true,
    "savingsPercent": 89
  }
}
```

## What It Does

AGNT Tool Codec uses deterministic scoring. No model call is required.

It looks at:

| Signal | Purpose |
| --- | --- |
| Intent | Is the user trying to search, create, analyze, fix, deploy, monitor, or configure? |
| Domain | Is the task about development, data, finance, communication, science, or system operations? |
| Keywords | Do message words match tool keywords, titles, plugin names, or descriptions? |
| Budget | How many tool schemas fit inside the configured token budget? |
| Fallbacks | Which safety tools should still be available when relevant tools are sparse? |

Default budget:

```text
7 tools x ~1,200 schema tokens = ~8,400 tokens
```

That keeps the selected set below the default `8,700` token budget while leaving far more context for reasoning and task data.

## Repository Layout

```text
.
|-- capability-index.json          # Tool capability manifest
|-- config.json                    # Weights, patterns, budget, fallbacks
|-- tool-codec.mjs                 # Small standalone Node runner
|-- tool-codec.js                  # Node library and CLI
|-- codec-integration.js           # AGNT-oriented integration module
|-- src/agnt_tool_codec/           # Dependency-free Python package
|-- spec/capability-index.schema.json
|-- docs/scoring.md                # Language-neutral scoring contract
|-- tests/test_python_codec.py
`-- test-codec.js
```

## Before You Install

Use the codec when your agent runtime has enough tools that schema noise becomes a real cost. If your agent only has three or four tools, you probably do not need this yet.

The codec expects a capability index:

```json
{
  "version": "1.1.0",
  "tools": [
    {
      "name": "github-plugin",
      "domain": "development",
      "intents": ["deploy", "search"],
      "keywords": ["github", "git", "push", "repository"],
      "description": "Interact with GitHub repositories"
    }
  ]
}
```

You can use the included `capability-index.json`, generate one from AGNT plugins, or produce your own from another framework.

## Python

Install locally:

```bash
python -m pip install -e .
```

Run the CLI:

```bash
agnt-tool-codec-py --index capability-index.json --config config.json "create a new plugin for monitoring"
```

Use as a library:

```python
from agnt_tool_codec import ToolCodec

codec = ToolCodec.from_files("capability-index.json", "config.json")
result = codec.select("search for current AI news")

for tool in result["selected"]:
    print(tool["tool"], tool["score"], tool["rationale"])
```

## Node

Run the standalone selector:

```bash
node tool-codec.mjs "check system health"
```

Run the richer CLI:

```bash
node tool-codec.js --query "push changes to github"
```

Import from Node:

```js
import { runCodec } from "./tool-codec.js";

const result = runCodec("validate the golden ratio claim");
console.log(result.selected);
```

## AGNT Integration

AGNT can call `codec-integration.js` before final tool injection:

1. Read the latest user message.
2. Score tools against `capability-index.json`.
3. Keep the top ranked tools under the token budget.
4. Merge with AGNT's required default/fallback tools.
5. Send the compact schema set to the model.

The codec is a selector, not an authority layer. Your orchestrator still decides which tools are allowed, which tools are safe, and which tools are required for the current surface.

## Configuration

```json
{
  "maxTools": 7,
  "minThreshold": 0.15,
  "tokenBudget": 8700,
  "domainBoost": 0.15,
  "historyBoost": 0.10,
  "fallbackTools": [
    "execute_javascript",
    "web_search",
    "file_operations"
  ]
}
```

Tune the codec by changing:

| Field | Effect |
| --- | --- |
| `maxTools` | Hard cap on selected tools |
| `minThreshold` | Minimum score required for inclusion |
| `tokenBudget` | Target schema-token budget |
| `intentPatterns` | Words that identify user intent |
| `domains` | Words that identify task domain |
| `fallbackTools` | Tools returned as fallback suggestions |

## Validation

Run all local checks:

```bash
npm test
python -m unittest discover -s tests -v
```

Current local baseline:

```text
Node smoke suite: 22/22 passing
Python unit suite: 3/3 passing
Default selection budget: 8,400 / 8,700 tokens
```

## Design Principles

- Deterministic first: no model call is required to rank tools.
- Portable core: the scoring contract is independent of AGNT.
- Runtime-owned safety: the codec recommends tools; the host runtime enforces permissions.
- Small context: selected tools should stay under budget by default.
- Inspectable output: every selected tool includes a score and rationale.

## License

Apache-2.0. See `LICENSE`.
