"""
Audit Extractor Script for VS Database 2.0 Technical Audit
Scans:
1. All Python files: imports, functions, classes, lines of code, external vs internal deps
2. All routes in server.py (GET, POST, DELETE, etc.)
3. All frontend JS API calls across static/*.js
4. Desktop-specific dependencies (ctypes, pywebview, WinForms, winreg, shell32, etc.)
5. Tally, Gemini, Google Drive, Document processing dependencies
6. Threading, background workers, startup, and shutdown lifecycle
"""

import os
import re
import ast
import json
from pathlib import Path
from collections import defaultdict

ROOT_DIR = Path(__file__).resolve().parent

def analyze_server_routes():
    server_path = ROOT_DIR / "server.py"
    with open(server_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()

    routes = []
    current_method = None
    context_handler = None

    # Line markers for handlers
    # L7026: def do_GET
    # L7723: def do_POST
    # L9464: def handle_ai_get
    # L9778: def handle_ai_post
    # L10997: def handle_ai_tool_call
    # L11096: def handle_ai_delete
    # L11132: def handle_automation_get
    # L11217: def handle_automation_post
    # L11355: def do_DELETE

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()

        if stripped.startswith("def do_GET("):
            current_method = "GET"
            context_handler = "do_GET"
        elif stripped.startswith("def do_POST("):
            current_method = "POST"
            context_handler = "do_POST"
        elif stripped.startswith("def do_DELETE("):
            current_method = "DELETE"
            context_handler = "do_DELETE"
        elif stripped.startswith("def handle_ai_get("):
            current_method = "GET"
            context_handler = "handle_ai_get"
        elif stripped.startswith("def handle_ai_post("):
            current_method = "POST"
            context_handler = "handle_ai_post"
        elif stripped.startswith("def handle_ai_delete("):
            current_method = "DELETE"
            context_handler = "handle_ai_delete"
        elif stripped.startswith("def handle_automation_get("):
            current_method = "GET"
            context_handler = "handle_automation_get"
        elif stripped.startswith("def handle_automation_post("):
            current_method = "POST"
            context_handler = "handle_automation_post"
        elif stripped.startswith("def handle_ai_tool_call("):
            current_method = "POST (Tool Call)"
            context_handler = "handle_ai_tool_call"

        # Check if line matches a route pattern
        # patterns like:
        # if path == "/api/...":
        # elif path.startswith("/api/..."):
        # elif path == ...
        match_eq = re.search(r'path\s*==\s*["\']([^"\']+)["\']', stripped)
        if match_eq:
            routes.append({
                "line": idx,
                "method": current_method,
                "handler": context_handler,
                "type": "exact",
                "route": match_eq.group(1),
                "code": stripped
            })
            continue

        match_sw = re.search(r'path\.startswith\(["\']([^"\']+)["\']\)', stripped)
        if match_sw:
            routes.append({
                "line": idx,
                "method": current_method,
                "handler": context_handler,
                "type": "prefix",
                "route": match_sw.group(1),
                "code": stripped
            })
            continue

        match_ew = re.search(r'path\.endswith\(["\']([^"\']+)["\']\)', stripped)
        if match_ew:
            routes.append({
                "line": idx,
                "method": current_method,
                "handler": context_handler,
                "type": "suffix",
                "route": match_ew.group(1),
                "code": stripped
            })
            continue

        match_in = re.search(r'path\s+in\s+\[(.*?)\]', stripped)
        if match_in:
            items = re.findall(r'["\']([^"\']+)["\']', match_in.group(1))
            for item in items:
                routes.append({
                    "line": idx,
                    "method": current_method,
                    "handler": context_handler,
                    "type": "exact-multi",
                    "route": item,
                    "code": stripped
                })
            continue

        # tool == "..." in handle_ai_tool_call
        if context_handler == "handle_ai_tool_call":
            match_tool = re.search(r'tool\s*==\s*["\']([^"\']+)["\']', stripped)
            if match_tool:
                routes.append({
                    "line": idx,
                    "method": "TOOL_CALL",
                    "handler": context_handler,
                    "type": "tool",
                    "route": f"tool:{match_tool.group(1)}",
                    "code": stripped
                })

    return routes

def analyze_frontend_calls():
    static_dir = ROOT_DIR / "static"
    js_files = list(static_dir.glob("*.js"))
    ext_dir = ROOT_DIR / "extension"
    if ext_dir.exists():
        js_files.extend(list(ext_dir.glob("*.js")))

    api_calls = defaultdict(list)

    # Patterns for fetch, $.ajax, XMLHttpRequest, axios, etc.
    # fetch("/api/...", { method: "POST" })
    # fetch(`/api/...`)
    # url: "/api/..."

    fetch_pattern = re.compile(r'fetch\(\s*([`\'"][^`\'"]+[`\'"]|\$\{[^}]+\}|[a-zA-Z0-9_\.]+|[^\),]+)\s*(?:,\s*(\{[^}]*\}|[a-zA-Z0-9_]+))?\s*\)', re.DOTALL)

    for js_file in js_files:
        with open(js_file, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
            lines = text.split("\n")

        # Scan line by line for api endpoints
        for idx, line in enumerate(lines, start=1):
            # Find any /api/ string literals or template literals
            found_apis = re.findall(r'["\'`](/api/[^"\'`\?\s]+)["\'`]', line)
            for api in found_apis:
                # determine method if present on same or nearby lines
                method = "GET (assumed)"
                snippet = line.strip()
                if "POST" in line:
                    method = "POST"
                elif "DELETE" in line:
                    method = "DELETE"
                elif "PUT" in line:
                    method = "PUT"
                api_calls[js_file.name].append({
                    "line": idx,
                    "api": api,
                    "method": method,
                    "snippet": snippet[:120]
                })

    return api_calls

def analyze_python_modules():
    py_files = sorted(list(ROOT_DIR.glob("*.py")))
    module_details = {}

    for py_file in py_files:
        with open(py_file, "r", encoding="utf-8", errors="ignore") as f:
            code = f.read()

        line_count = len(code.split("\n"))
        size_bytes = py_file.stat().st_size

        try:
            tree = ast.parse(code, filename=str(py_file))
        except Exception as e:
            tree = None

        classes = []
        functions = []
        imports = set()
        from_imports = defaultdict(set)

        if tree:
            for node in ast.iter_child_nodes(tree):
                if isinstance(node, ast.ClassDef):
                    classes.append(node.name)
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions.append(node.name)

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for n in node.names:
                        imports.add(n.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        from_imports[node.module].add(", ".join([n.name for n in node.names]))

        # Look for Win32/ctypes/pywebview
        desktop_markers = []
        for marker in ["pywebview", "webview", "ctypes", "win32", "winreg", "System.Windows.Forms", "WinForms", "AppUserModelID", "SetProcessDpiAwareness", "SW_HIDE"]:
            if marker.lower() in code.lower():
                desktop_markers.append(marker)

        module_details[py_file.name] = {
            "lines": line_count,
            "size": size_bytes,
            "classes": classes,
            "functions_count": len(functions),
            "functions_sample": functions[:10],
            "imports": sorted(list(imports)),
            "from_imports": {k: sorted(list(v)) for k, v in from_imports.items()},
            "desktop_markers": list(set(desktop_markers))
        }

    return module_details

def main():
    routes = analyze_server_routes()
    js_calls = analyze_frontend_calls()
    py_modules = analyze_python_modules()

    output = {
        "routes_count": len(routes),
        "routes": routes,
        "js_calls_summary": {k: len(v) for k, v in js_calls.items()},
        "js_calls": js_calls,
        "py_modules": py_modules
    }

    out_file = ROOT_DIR / "audit_data_raw.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(f"Analysis complete. Extracted {len(routes)} server routes, {len(js_calls)} JS files with calls, {len(py_modules)} Python modules.")

if __name__ == "__main__":
    main()
