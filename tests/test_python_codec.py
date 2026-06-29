import unittest

from agnt_tool_codec import ToolCodec, encode_intent, select_tools


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


if __name__ == "__main__":
    unittest.main()
