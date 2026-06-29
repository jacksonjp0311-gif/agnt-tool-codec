from agnt_tool_codec import filter_dict_tools


tools = [
    {
        "name": "web_search",
        "description": "Search the web for current information.",
    },
    {
        "name": "send_slack",
        "description": "Send a Slack message to the team.",
    },
    {
        "name": "query_database",
        "description": "Query SQL customer records.",
    },
]


filtered_tools, report = filter_dict_tools("send the team a slack update", tools)

print("selected:", [tool["name"] for tool in filtered_tools])
print("tokens:", report["metadata"]["tokenEstimate"], "/", report["metadata"]["staticTokenEstimate"])
