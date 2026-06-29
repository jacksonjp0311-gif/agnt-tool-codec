# AGNT Tool Codec — Architecture & Integration

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AGNT ORCHESTRATOR PIPELINE                        │
│                                                                     │
│  User Message                                                       │
│      │                                                              │
│      ▼                                                              │
│  ┌──────────────────────────────────────┐                           │
│  │     ┌─────────────────────────┐      │                           │
│  │     │   CODEC ENCODER         │      │  NEW: Intent extraction  │
│  │     │   • Tokenize message    │      │  NEW: Domain detection   │
│  │     │   • Extract intent      │      │  NEW: Keyword scoring    │
│  │     │   • Detect domain       │      │                           │
│  │     └──────────┬──────────────┘      │                           │
│  │                │                      │                           │
│  │                ▼                      │                           │
│  │     ┌─────────────────────────┐      │                           │
│  │     │   CODEC SELECTOR        │      │  NEW: 6-signal scoring   │
│  │     │   • Keyword overlap     │      │  NEW: Domain boost       │
│  │     │   • Domain match        │      │  NEW: Intent match       │
│  │     │   • Description match   │      │  NEW: Title match        │
│  │     │   • Plugin name match   │      │                           │
│  │     └──────────┬──────────────┘      │                           │
│  │                │                      │                           │
│  │                ▼                      │                           │
│  │     ┌─────────────────────────┐      │                           │
│  │     │   CODEC DECODER         │      │  NEW: Rank + budget      │
│  │     │   • Apply token budget  │      │  NEW: Add fallbacks      │
│  │     │   • Rank by confidence  │      │                           │
│  │     └──────────┬──────────────┘      │                           │
│  │                │                      │                           │
│  │                ▼                      │                           │
│  │  ┌─────────────────────────────────┐ │                           │
│  │  │  EXISTING TOOL SELECTOR         │ │  UNCHANGED               │
│  │  │  • DEFAULT_TOOLS (always in)    │ │                           │
│  │  │  • Keyword group matching       │ │                           │
│  │  │  • Plugin tool auto-load        │ │                           │
│  │  │  • Guidance section selection   │ │                           │
│  │  └──────────┬──────────────────────┘ │                           │
│  │             │                         │                           │
│  │             ▼                         │                           │
│  │  ┌─────────────────────────────────┐ │                           │
│  │  │  MERGE: Codec ranked + Group    │ │  NEW: Merge layer        │
│  │  │  matched → Final schema list    │ │  NEW: Dedup + prioritize │
│  │  └──────────┬──────────────────────┘ │                           │
│  │             │                         │                           │
│  └─────────────┼─────────────────────────┘                           │
│                │                                                     │
│                ▼                                                     │
│         LLM receives optimized tool set                              │
│         (8 tools instead of 40+)                                     │
│         (~8.7K tokens instead of ~77K)                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Scoring Signals (6 layers)

| Signal | Weight | What it catches |
|--------|--------|-----------------|
| **Keyword overlap** | 0-0.5 | Direct word matches between user message and tool keywords |
| **Raw keyword overlap** | 0-0.3 | Domain-critical words that survive stopword filtering |
| **Domain match** | +0.15 | User's domain matches tool's domain (system/finance/dev/etc.) |
| **Intent match** | +0.20 | User's intent matches tool's declared intents |
| **Description match** | 0-0.3 | User keywords appear in tool description |
| **Title match** | +0.1/word | User keywords appear in tool title |

## Token Budget

- **Budget**: 8,700 tokens (configurable)
- **Per-tool cost**: ~1,200 tokens (OpenAPI schema overhead)
- **Max tools**: 8 (within budget)
- **Fallbacks**: Always add execute-javascript, web-search, file-operations if room

## Integration Points

### 1. Drop-in replacement for selectTools()

In `toolSelector.js`, the existing `selectTools()` function is enhanced: codec scoring runs first to produce a relevance rank, then existing keyword matching applies for backward compatibility.

### 2. Capability Index

Auto-generated from scanning all plugin `manifest.json` files. Contains tool name, description, inferred domain, intents, and extracted keywords.

### 3. Selection Log

Every codec selection is logged to `selection-log.json` for analysis and dashboard rendering.

## Benchmarks

### Runtime Benchmark (35 cases)

| Metric | Current baseline |
|--------|------------------|
| Cases | 35 |
| Top-1 coverage | 94.3% |
| Top-3 coverage | 100% |
| Any-position coverage | 100% |
| Estimated schema-token savings | 91.1% |

Run it with:

```bash
agnt-tool-codec-eval --index capability-index.json --cases evals/runtime-cases.json --min-top3 1.0 --min-covered 1.0 --min-savings 0.85
```

### Token Savings

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Tools in context | 64 | 2-7 | Up to 89% fewer |
| Schema tokens | 2,688,000 | 240,000 | 91.1% reduction |
| Reasoning context | 23% | 78% | 3.4x more room |
| Top-3 coverage | n/a | 100% | benchmark-gated |

## How to Extend

1. **Add new tools**: Drop a plugin in `plugins/dev/`, run `node build-index.js`
2. **Tune thresholds**: Edit `config.json` — `minThreshold`, `domainBoost`, etc.
3. **Add intent patterns**: Extend `intentPatterns` in codec-integration.js
4. **Custom domains**: Add to `DOMAINS` map in codec-integration.js
5. **Dashboard**: Open `dashboard.html` in browser for live selection log

## What We Learned

1. **Stopword lists are dangerous**. Our first attempt included domain-critical words like "bitcoin", "health", "drift" in the stopwords list — the codec scored 0 for most queries. Fix: use a MINIMAL stopwords list and let scoring handle noise.

2. **Dual keyword matching is essential**. Filtered keywords (minus stopwords) give precision. Raw keywords (all words) give recall. Using both catches tools that match on domain words like "system" or "monitor" that would otherwise be filtered out.

3. **Domain detection > intent detection**. Getting the domain right (system vs finance vs development) is more valuable than getting the intent right (monitor vs check vs observe) because tools cluster by domain.

4. **Plugin tools have thin manifests**. Many plugins declare only a type and one-line description. The codec compensates by extracting keywords from plugin name + description + inferred category, but richer manifests = better selection.

5. **The 0.20 threshold is the sweet spot**. Below 0.15, too many irrelevant tools sneak in. Above 0.30, compound queries ("check system health AND monitor credits") drop valid tools. 0.20 catches 85%+ of relevant tools.
