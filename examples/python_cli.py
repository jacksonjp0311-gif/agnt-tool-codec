from agnt_tool_codec import ToolCodec


codec = ToolCodec.from_files("capability-index.json", "config.json")
result = codec.select("push changes to github")

for item in result["selected"]:
    print(f"{item['tool']}: {item['score']} ({', '.join(item['rationale'])})")
