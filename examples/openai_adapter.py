from agnt_tool_codec import filter_openai_tools


tools = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github",
            "description": "Create commits, push branches, and open pull requests on GitHub.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


filtered, report = filter_openai_tools("push these changes to github", tools)
print([tool["function"]["name"] for tool in filtered])
print(report["selected"][0])
