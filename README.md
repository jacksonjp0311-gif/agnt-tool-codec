# AGNT Tool Codec (v1.0.0)

**Intent-first dynamic tool selection for AGNT.**

AGNT Tool Codec sits between a user message and tool-schema injection. Instead of shipping *dozens* of tool schemas into every model call, it scores your full tool ecosystem against the current message and injects only the most relevant handful.

- **Massive context savings** (measured ~77K → ~8.7K tokens, ~89% reduction)
- **Higher accuracy** by avoiding “tool overload”
- **Drop-in integration** for AGNT’s orchestrator (`toolSelector.js`)

---

## Why this exists

Large tool registries create a paradox:

- More tools = more capability
- But more schemas in-context = less reasoning room, more distraction, worse tool choice

Tool Codec addresses this by converting:

> **User intent → ranked shortlist → token-budgeted tool injection**

---

## What it does (pipeline)

```
User message
   │
   ▼
ENCODE  →  SELECT  →  DECODE
(intent/domain)   (score tools)   (apply token budget + fallbacks)
   │
   ▼
5–8 relevant tools injected into the LLM call
```

**Encoder**
- Tokenizes the message
- Classifies a coarse **intent** (e.g. monitor / search / fix / build / analyze)
- Classifies a coarse **domain** (e.g. system / dev / finance / comms / science)

**Selector**
Scores each tool using weighted evidence such as:
- keyword overlap
- domain match
- intent match
- title/description affinity
- optional history bias

**Decoder**
- Ranks tools by score
- Enforces a **token budget** (default 8700)
- Adds sensible **fallback tools**

---

## Measured results (AGNT instance)

| Metric | Static “load everything” | Codec shortlist |
|---|---:|---:|
| Tool schemas injected | 40+ | 5–8 |
| Schema tokens | ~77,000 | ~8,700 |
| Reasoning headroom | low | high |
| Benchmark match rate | ~62% | **86.7% (13/15)** |

Codec emits logs like:

```
[Codec] intent=analyze domain=system selected=8 savings=80%
```

---

## Repository layout

| File | Purpose |
|---|---|
| `tool-codec.mjs` | Core engine (ESM) — encode/score/select/decode |
| `tool-codec.js` | CJS-compatible build (used by some integrations) |
| `codec-integration.js` | Orchestrator-facing integration shim |
| `capability-index.json` | Tool capability manifest (generated) |
| `config.json` | Weights, thresholds, token budget, fallbacks |
| `build-index.js` | Build/refresh the capability index from your ecosystem |
| `test-codec.js` | Benchmark harness |
| `dashboard.html` | Self-contained evaluator dashboard |
| `ARCHITECTURE.md` | Deeper design notes |

---

## Quickstart (standalone)

```bash
# 1) Run the engine
node tool-codec.mjs "check system health"

# 2) Run the benchmark suite
node test-codec.js

# 3) Rebuild tool capability index (point at your plugins/tools folder)
node build-index.js ../agnt-evo/backend/plugins/dev/
```

---

## Integrating into AGNT (recommended)

There are two common ways to integrate:

### A) Orchestrator patch (highest leverage)

1. Copy this repo (or at least `codec-integration.js` + index/config files) into:
   
   `agnt-evo/backend/plugins/dev/agnt-tool-codec/`

2. Patch AGNT orchestrator tool selection to call the codec **before** keyword/group matching.
   
   The proven integration pattern is:
   - `createRequire(import.meta.url)`
   - `require(".../codec-integration.js")`
   - `try/catch` fail-open back to existing selection logic
   - **merge** codec results with matched groups (additive, not destructive)

3. Restart AGNT.

You should see `[Codec] ...` lines in the server console on chat turns.

### B) Run as an AGNT custom tool

Codec can also be registered as a callable tool that returns ranked tool IDs for the orchestrator to consume. This is useful for experimentation, dashboards, and offline analysis.

---

## Configuration

Edit `config.json`:

```json
{
  "maxTools": 8,
  "minThreshold": 0.2,
  "tokenBudget": 8700,
  "domainBoost": 0.15,
  "historyBoost": 0.1,
  "fallbackTools": [
    "execute-javascript-code",
    "web-search",
    "file-operations"
  ]
}
```

Key lesson from production: **keep stopwords minimal**. Over-aggressive stopword lists can erase the very domain terms you’re trying to detect.

---

## Dashboard

Open `dashboard.html` to:
- type a message
- see ranked tools + scores
- compare “expected vs selected” for benchmark cards
- inspect token estimates

---

## Roadmap (next evolutions)

- Learned embeddings / semantic similarity (optional, pluggable)
- Per-user tool priors + success-rate weighting
- Automatic drift detection: tool churn vs selection stability
- Formal evaluation harness + regression gating in CI

---

## Contributing

PRs welcome, especially for:
- better intent/domain classifiers
- more robust index building across heterogeneous tool registries
- evaluation datasets and scoring

---

## License

Apache-2.0.

---

Built for the AGNT ecosystem (2026-06-28).