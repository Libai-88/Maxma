# Blue Mode Choice

**Mode**: B

**Rationale**: The arbiter flagged 7 specific challenge angles on Red's Round 2 fixes. After reading all 5 prep files and source-diffing the actual `api/data/mcp_servers.yaml` against Red's new `parseYaml` in `bun-sidecar/src/tools/config/manage_mcp.ts`, I have a concrete, reproducible challenge for B-010 (the new parser mis-parses the project's own config file — `args` list loses items and `D:/Maxma` is parsed as a dict `{D:"/Maxma"}`). I also have a moderate challenge for B-007 (undo can pass an empty array to `replaceMessages` and does not preserve the leading `system` message, unlike `compact`). With the score at 25-20, confirmed challenges at +5 each close the gap fastest. Picking Mode B.
