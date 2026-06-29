import unittest

from agnt_tool_codec import (
    ToolCodec,
    capabilities_from_openai_tools,
    capability_from_dict_tool,
    capability_from_callable,
    encode_intent,
    filter_dict_tools,
    filter_openai_tools,
    select_tools,
)
from agnt_tool_codec.eval import run_eval


TOOLS = [
    {
        "name": "system-coherence-monitor",
        "title": "System Coherence Monitor",
        "domain": "system",
        "category": "telemetry",
        "intents": ["monitor", "analyze"],
        "keywords": ["system", "coherence", "health", "monitor", "state", "status"],
        "description": "Monitor system state coherence and health.",
    },
    {
        "name": "github-plugin",
        "title": "GitHub Plugin",
        "domain": "development",
        "category": "development",
        "intents": ["create", "search", "deploy"],
        "keywords": ["github", "git", "repository", "commit", "push", "pull", "pr"],
        "description": "Interact with GitHub repositories, commits, pull requests, and issues.",
    },
    {
        "name": "web-search",
        "title": "Web Search",
        "domain": "data",
        "category": "core",
        "intents": ["search"],
        "keywords": ["search", "find", "lookup", "research", "web", "news"],
        "description": "Search the web for current information.",
    },
]


class PythonCodecTests(unittest.TestCase):
    def test_encode_detects_intent_and_domain(self):
        intent = encode_intent("push changes to github")
        self.assertEqual(intent["primaryIntent"], "deploy")
        self.assertEqual(intent["primaryDomain"], "development")

    def test_selects_relevant_tool(self):
        result = select_tools("check system health", TOOLS)
        self.assertEqual(result["selected"][0]["tool"], "system-coherence-monitor")
        self.assertTrue(result["metadata"]["withinBudget"])

    def test_codec_class_from_data(self):
        codec = ToolCodec(TOOLS)
        result = codec.select("search AI news")
        names = [item["tool"] for item in result["selected"]]
        self.assertIn("web-search", names[:2])

    def test_accepts_iterable_tool_inputs(self):
        result = select_tools("push changes to github", (tool for tool in TOOLS))
        self.assertEqual(result["metadata"]["staticTokenEstimate"], len(TOOLS) * 1200)
        self.assertEqual(result["selected"][0]["tool"], "github-plugin")

    def test_openai_adapter_filters_and_orders_tools(self):
        openai_tools = [
            {"type": "function", "function": {"name": "web_search", "description": "Search web news."}},
            {"type": "function", "function": {"name": "github", "description": "Push commits to GitHub."}},
        ]
        filtered, report = filter_openai_tools("push this branch to github", openai_tools)
        self.assertEqual(filtered[0]["function"]["name"], "github")
        self.assertEqual(report["selected"][0]["tool"], "github")

    def test_openai_adapter_builds_capabilities(self):
        caps = capabilities_from_openai_tools([
            {"type": "function", "function": {"name": "send_slack", "description": "Send a Slack message."}},
        ])
        self.assertEqual(caps[0]["name"], "send_slack")
        self.assertIn("communication", caps[0]["domain"])

    def test_callable_adapter_uses_docstring(self):
        def query_database():
            """Query SQL customer records."""

        cap = capability_from_callable(query_database)
        self.assertEqual(cap["name"], "query_database")
        self.assertEqual(cap["domain"], "data")

    def test_generic_dict_adapter_filters_tools(self):
        tools = [
            {"name": "send_slack", "description": "Send a Slack message to the team."},
            {"name": "query_database", "description": "Query SQL customer records."},
        ]
        cap = capability_from_dict_tool(tools[0])
        self.assertEqual(cap["name"], "send_slack")
        filtered, report = filter_dict_tools("send the team a slack update", tools)
        self.assertEqual(filtered[0]["name"], "send_slack")
        self.assertEqual(report["selected"][0]["tool"], "send_slack")

    def test_eval_runner_reports_top3(self):
        codec = ToolCodec(TOOLS)
        report = run_eval(codec, [
            {"message": "push changes to github", "expected_tools": ["github-plugin"]},
            {"message": "search AI news", "expected_tools": ["web-search"]},
            {"message": "push changes to github", "expected_tools": ["git_tool"], "acceptable_tools": ["github-plugin"]},
        ])
        self.assertEqual(report["summary"]["cases"], 3)
        self.assertEqual(report["summary"]["top3"], 3)
        self.assertEqual(report["summary"]["strictTop3"], 2)
        self.assertGreater(report["summary"]["tokensSaved"], 0)
        self.assertGreater(report["summary"]["savingsRate"], 0)


if __name__ == "__main__":
    unittest.main()
