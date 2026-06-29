# Tool Codec Scoring Contract

The codec is a language-neutral ranking layer for agent tools.

Input:

```json
{
  "message": "push changes to github",
  "tools": [
    {
      "name": "github-plugin",
      "domain": "development",
      "intents": ["deploy", "search"],
      "keywords": ["github", "git", "push", "repository"],
      "description": "Interact with GitHub repositories"
    }
  ],
  "maxTools": 7
}
```

Output:

```json
{
  "selected": [
    {
      "tool": "github-plugin",
      "score": 1.0,
      "rationale": ["kw:github", "int:deploy", "dom:development"]
    }
  ],
  "fallbacks": ["execute_javascript_code", "web_search", "file_operations"],
  "metadata": {
    "tokenEstimate": 1200,
    "savingsPercent": 89
  }
}
```

Scoring signals:

| Signal | Default weight |
| --- | ---: |
| Filtered keyword overlap | 0.0-0.5 |
| Raw keyword overlap | 0.0-0.3 |
| Domain match | +0.15 |
| Intent match | +0.20 |
| Description overlap | 0.0-0.3 |
| Title overlap | +0.10 per word |
| Plugin-name overlap | +0.05 per word |

The core library should not write logs or mutate state. Runtimes may add logging
around the selection result.

## Adapters

The Python package includes helpers for common tool shapes:

- `filter_openai_tools(message, tools)` filters OpenAI Chat/Responses function tools.
- `capability_from_openai_tool(tool)` converts one OpenAI tool to codec metadata.
- `capability_from_callable(func)` converts a Python callable using its name and docstring.

Adapters are intentionally lossy: they infer domain, intent, and keywords from
names/descriptions. For production indexes, richer hand-authored metadata will
rank better.
