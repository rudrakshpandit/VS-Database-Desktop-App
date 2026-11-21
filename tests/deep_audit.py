"""
Deep Audit Script to inspect and output details for:
- Detailed route catalog
- Detailed JS frontend calls catalog
- Desktop dependencies & win32 calls
- Lifecycle, background threads, and sockets
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

with open(ROOT / "audit_data_raw.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print("Total routes:", len(data["routes"]))

handlers = ["do_GET", "handle_ai_get", "handle_automation_get", "do_POST", "handle_ai_post", "handle_ai_tool_call", "handle_automation_post", "do_DELETE", "handle_ai_delete"]

for h in handlers:
    h_routes = [r for r in data["routes"] if r["handler"] == h]
    print(f"\n--- {h} ({len(h_routes)} routes) ---")
    for r in h_routes:
        print(f"  [{r['method']}] {r['route']} (L{r['line']})")
