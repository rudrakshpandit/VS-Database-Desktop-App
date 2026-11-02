"""
Tally MCP Client & Connector for VS Database
Communicates via stdio protocol with dhananjay1405/tally-mcp-server (Node.js).
Manages child process lifecycle, protocol handshakes, schema discovery,
response normalization, timeout management, and safe shutdown.
"""

from __future__ import annotations
import os
import sys
import json
import time
import socket
import logging
import threading
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("vs_database.tally_mcp")

class TallyMCPClient:
    _instance: Optional[TallyMCPClient] = None
    _instance_lock = threading.Lock()

    def __init__(self, mcp_server_dir: Optional[Path] = None):
        self.app_root = Path(__file__).resolve().parent
        if mcp_server_dir:
            self.mcp_server_dir = mcp_server_dir
        else:
            # Default to sibling or project tally-mcp-server
            candidates = [
                self.app_root.parent / "tally-mcp-server",
                self.app_root / "tally-mcp-server",
                Path("D:/AntiGravity Automation/tally-mcp-server")
            ]
            self.mcp_server_dir = candidates[0]
            for c in candidates:
                if c.exists() and (c / "dist" / "index.mjs").exists():
                    self.mcp_server_dir = c
                    break

        self.node_executable = "node"
        self.proc: Optional[subprocess.Popen] = None
        self.proc_lock = threading.Lock()
        self.msg_id = 0
        self.active_company: Optional[str] = None
        self.discovered_tools: Dict[str, Any] = {}
        self.server_info: Dict[str, Any] = {}
        self.is_initialized = False
        self.last_error: Optional[str] = None
        self._node_check_cache: Optional[Tuple[bool, str]] = None
        self._status_cache: Optional[Dict[str, Any]] = None
        self._status_cache_time: float = 0.0

    @classmethod
    def get_instance(cls, mcp_server_dir: Optional[Path] = None) -> TallyMCPClient:
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = TallyMCPClient(mcp_server_dir)
            return cls._instance

    def check_node_installed(self) -> Tuple[bool, str]:
        """Checks if Node.js is installed and meets runtime version requirements (cached)."""
        if self._node_check_cache is not None:
            return self._node_check_cache
        try:
            cflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            res = subprocess.run([self.node_executable, "--version"], capture_output=True, text=True, timeout=3, creationflags=cflags)
            if res.returncode == 0:
                self._node_check_cache = (True, res.stdout.strip())
                return self._node_check_cache
            self._node_check_cache = (False, "Node.js returned non-zero code.")
            return self._node_check_cache
        except Exception as e:
            self._node_check_cache = (False, f"Node.js not found: {e}")
            return self._node_check_cache

    def check_tally_port_reachable(self, host: str = "127.0.0.1", port: int = 9000, timeout: float = 0.25) -> bool:
        """Probes TallyPrime XML port (default 9000) directly for fast pre-flight status."""
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except Exception:
            return False

    def find_tally_executable(self) -> Optional[str]:
        """Finds TallyPrime executable on standard Windows install paths."""
        candidates = [
            r"C:\Program Files\TallyPrime\tally.exe",
            r"C:\Program Files\Tally\TallyPrime\tally.exe",
            r"C:\Program Files (x86)\TallyPrime\tally.exe",
            r"C:\TallyPrime\tally.exe",
            r"D:\TallyPrime\tally.exe",
        ]
        for c in candidates:
            if os.path.isfile(c):
                return c
        return None

    def launch_tally(self) -> Dict[str, Any]:
        """Launches TallyPrime if installed on this computer."""
        exe = self.find_tally_executable()
        if not exe:
            return {"ok": False, "error": "TallyPrime executable not found in standard directories"}
        try:
            if sys.platform == "win32":
                os.startfile(exe)
            else:
                cwd = os.path.dirname(exe)
                subprocess.Popen([exe], cwd=cwd)
            return {"ok": True, "message": "Launching TallyPrime..."}
        except Exception as e:
            return {"ok": False, "error": f"Failed to launch TallyPrime: {e}"}

    def get_connection_status(self, force_refresh: bool = False) -> Dict[str, Any]:
        """Returns deep diagnostic connection status without exposing secrets."""
        now = time.time()
        if not force_refresh and self._status_cache is not None and (now - self._status_cache_time) < 2.5:
            return self._status_cache

        node_ok, node_ver = self.check_node_installed()
        entry_exists = (self.mcp_server_dir / "dist" / "index.mjs").exists()
        tally_port_open = self.check_tally_port_reachable()
        tally_exe = self.find_tally_executable()

        status_state = "Not configured"
        recovery_instruction = ""

        if not node_ok:
            status_state = "Node.js unavailable"
            recovery_instruction = "Install Node.js v18+ and ensure 'node' is accessible in PATH."
        elif not entry_exists:
            status_state = "MCP server unavailable"
            recovery_instruction = f"Tally MCP Server build not found at {self.mcp_server_dir / 'dist' / 'index.mjs'}."
        elif not tally_port_open:
            status_state = "Tally not reachable"
            if tally_exe:
                recovery_instruction = "TallyPrime XML server is offline. Click 'Open Tally' or start TallyPrime and ensure XML server is enabled on port 9000."
            else:
                recovery_instruction = "Open TallyPrime and enable XML Server on port 9000 (F1 > Settings > Connectivity > Client/Server configuration)."
        else:
            # Check company
            if not self.proc or self.proc.poll() is not None:
                try:
                    self.start_process()
                except Exception as e:
                    self.last_error = str(e)

            if self.is_initialized:
                if self.active_company:
                    status_state = "Connected and ready"
                    recovery_instruction = f"Connected to TallyPrime. Active Company: {self.active_company}"
                else:
                    status_state = "Tally reachable; no company selected"
                    recovery_instruction = "TallyPrime XML server is responding. Please select an open Company."
            else:
                status_state = "Starting"
                recovery_instruction = "Initializing MCP server connection..."

        res = {
            "status_state": status_state,
            "node_available": node_ok,
            "node_version": node_ver,
            "mcp_server_dir": str(self.mcp_server_dir),
            "mcp_entry_exists": entry_exists,
            "tally_port_open": tally_port_open,
            "tally_installed": bool(tally_exe),
            "tally_exe_path": tally_exe,
            "is_process_running": bool(self.proc and self.proc.poll() is None),
            "is_initialized": self.is_initialized,
            "active_company": self.active_company,
            "tools_count": len(self.discovered_tools),
            "recovery_instruction": recovery_instruction,
            "last_error": self.last_error
        }
        self._status_cache = res
        self._status_cache_time = now
        return res

    def start_process(self):
        """Starts the MCP server child process and completes initialize handshake."""
        with self.proc_lock:
            if self.proc and self.proc.poll() is None:
                return

            entry_point = self.mcp_server_dir / "dist" / "index.mjs"
            if not entry_point.exists():
                raise FileNotFoundError(f"MCP server entry point does not exist: {entry_point}")

            cflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            self.proc = subprocess.Popen(
                [self.node_executable, str(entry_point)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=str(self.mcp_server_dir),
                bufsize=1,
                creationflags=cflags
            )

            # Perform MCP initialization handshake
            self.msg_id += 1
            init_req = {
                "jsonrpc": "2.0",
                "id": self.msg_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "VS Database", "version": "1.0.0"}
                }
            }

            resp = self._send_raw(init_req, timeout=10)
            if not resp or "error" in resp:
                err_msg = resp.get("error", {}).get("message", "Unknown initialize error") if resp else "No response"
                self.terminate()
                raise RuntimeError(f"MCP Initialize failed: {err_msg}")

            self.server_info = resp.get("result", {}).get("serverInfo", {})

            # Send initialized notification
            notif = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }
            if self.proc and self.proc.stdin:
                self.proc.stdin.write(json.dumps(notif) + "\n")
                self.proc.stdin.flush()

            self.is_initialized = True
            self.last_error = None
            self._discover_tools()

    def _discover_tools(self):
        """Fetches and normalizes available tools and input schemas."""
        self.msg_id += 1
        req = {
            "jsonrpc": "2.0",
            "id": self.msg_id,
            "method": "tools/list",
            "params": {}
        }
        resp = self._send_raw(req, timeout=10)
        if resp and "result" in resp:
            tools_list = resp["result"].get("tools", [])
            self.discovered_tools = {t["name"]: t for t in tools_list}
            logger.info(f"Discovered {len(self.discovered_tools)} MCP tools from Tally MCP server")

    def _send_raw(self, msg: dict, timeout: float = 20.0) -> Optional[dict]:
        """Sends a JSON-RPC message over stdin and reads response from stdout."""
        if not self.proc or self.proc.poll() is not None:
            return None

        try:
            line = json.dumps(msg) + "\n"
            self.proc.stdin.write(line)
            self.proc.stdin.flush()

            # Read line with timeout safely on Windows
            res = [None]
            def _reader():
                try:
                    res[0] = self.proc.stdout.readline()
                except Exception:
                    pass

            t = threading.Thread(target=_reader)
            t.daemon = True
            t.start()
            t.join(timeout)

            if res[0] is None or not res[0].strip():
                return {"error": {"message": f"Operation timed out after {timeout}s"}}

            return json.loads(res[0].strip())
        except Exception as e:
            self.last_error = str(e)
            return {"error": {"message": str(e)}}

    def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
        """Calls an MCP tool and normalizes the response."""
        # Fast pre-flight check for live Tally port 9000
        # If the tool requires Tally communication and Tally port is closed, fail immediately
        tally_tools = ("list-master", "chart-of-accounts", "trial-balance", "profit-loss", "balance-sheet", "stock-summary", "ledger-balance", "bills-outstanding", "ledger-account", "stock-item-account", "voucher-journal", "ledger-create-update", "delete-master")
        if name in tally_tools and not self.check_tally_port_reachable(timeout=0.3):
            return {
                "ok": False,
                "error": "Unable to connect to Tally. Ensure Tally is running and XML server is enabled on port 9000 (Help > Settings > Connectivity > Client/Server configuration)."
            }

        if not self.proc or self.proc.poll() is not None or not self.is_initialized:
            try:
                self.start_process()
            except Exception as e:
                return {"ok": False, "error": f"Failed to connect to Tally MCP server: {e}"}

        with self.proc_lock:

            args = arguments or {}
            # If targetCompany is omitted and active_company is set, pass targetCompany
            if "targetCompany" not in args and self.active_company:
                args["targetCompany"] = self.active_company

            self.msg_id += 1
            call_req = {
                "jsonrpc": "2.0",
                "id": self.msg_id,
                "method": "tools/call",
                "params": {
                    "name": name,
                    "arguments": args
                }
            }

            raw_resp = self._send_raw(call_req, timeout=timeout)
            if not raw_resp:
                return {"ok": False, "error": "No response from MCP server"}

            if "error" in raw_resp:
                err_msg = raw_resp["error"].get("message", "MCP Tool Error")
                return {"ok": False, "error": err_msg}

            result = raw_resp.get("result", {})
            is_error = result.get("isError", False)
            content_list = result.get("content", [])

            # Extract content text/data
            text_chunks = []
            for item in content_list:
                if item.get("type") == "text":
                    text_chunks.append(item.get("text", ""))

            combined_text = "\n".join(text_chunks).strip()

            # Try to parse JSON from text response if possible
            parsed_data = None
            if combined_text:
                try:
                    parsed_data = json.loads(combined_text)
                except Exception:
                    parsed_data = combined_text

            if is_error:
                error_text = parsed_data if isinstance(parsed_data, str) else str(parsed_data or "Tool execution error")
                return {
                    "ok": False,
                    "error": error_text,
                    "raw_text": combined_text
                }

            return {
                "ok": True,
                "tool": name,
                "data": parsed_data,
                "raw_text": combined_text
            }

    def _query_tally_direct(self, xml_payload: str, timeout: float = 2.5) -> Optional[str]:
        """Directly sends an XML envelope to TallyPrime's HTTP XML server on port 9000."""
        try:
            import urllib.request
            req = urllib.request.Request(
                "http://127.0.0.1:9000",
                data=xml_payload.encode("utf-8"),
                headers={"Content-Type": "text/xml;charset=utf-8"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                try:
                    return raw.decode("utf-8")
                except UnicodeDecodeError:
                    return raw.decode("utf-16", errors="ignore")
        except Exception:
            return None

    def query_tally_companies_direct(self) -> List[str]:
        """Queries TallyPrime XML server directly for loaded open companies."""
        # 1. TDL-based Company Collection
        xml1 = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>CompanyListReport</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="CompanyListReport">
            <FORMS>CompanyListForm</FORMS>
          </REPORT>
          <FORM NAME="CompanyListForm">
            <PARTS>CompanyListPart</PARTS>
            <XMLTAG>DATA</XMLTAG>
          </FORM>
          <PART NAME="CompanyListPart">
            <LINES>CompanyListLine</LINES>
            <REPEAT>CompanyListLine : CompanyCollection</REPEAT>
            <SCROLLED>Vertical</SCROLLED>
          </PART>
          <LINE NAME="CompanyListLine">
            <FIELDS>fld_CompanyName</FIELDS>
            <XMLTAG>ROW</XMLTAG>
          </LINE>
          <FIELD NAME="fld_CompanyName">
            <SET>$Name</SET>
            <XMLTAG>Name</XMLTAG>
          </FIELD>
          <COLLECTION NAME="CompanyCollection">
            <TYPE>Company</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>"""
        resp1 = self._query_tally_direct(xml1)
        import re
        companies = []
        if resp1:
            found = re.findall(r'<Name[^>]*>(.*?)</Name>', resp1, re.DOTALL | re.IGNORECASE)
            for name in found:
                clean = re.sub(r'<[^>]+>', '', name).strip()
                if clean and clean not in companies and not clean.startswith('$$'):
                    companies.append(clean)

        # 2. Fallback: Standard Export Data Report
        if not companies:
            xml2 = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Company</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>"""
            resp2 = self._query_tally_direct(xml2)
            if resp2:
                found2 = re.findall(r'<NAME[^>]*>(.*?)</NAME>', resp2, re.DOTALL | re.IGNORECASE)
                for name in found2:
                    clean = re.sub(r'<[^>]+>', '', name).strip()
                    if clean and clean not in companies and not clean.startswith('$$'):
                        companies.append(clean)

        # 3. Fallback: Query $$CurrentCompany directly
        if not companies:
            xml3 = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>$$CurrentCompany</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>"""
            resp3 = self._query_tally_direct(xml3)
            if resp3:
                found3 = re.findall(r'<(?:CURRENTCOMPANY|COMPANY|NAME)[^>]*>(.*?)</(?:CURRENTCOMPANY|COMPANY|NAME)>', resp3, re.DOTALL | re.IGNORECASE)
                for name in found3:
                    clean = re.sub(r'<[^>]+>', '', name).strip()
                    if clean and clean not in companies and not clean.startswith('$$') and len(clean) > 1 and '\n' not in clean:
                        companies.append(clean)

        return companies

    def list_companies(self) -> Dict[str, Any]:
        """Lists all companies available in TallyPrime with multi-layer direct XML & MCP fallback."""
        # 1. Fast direct XML check if Tally port is reachable
        if self.check_tally_port_reachable(timeout=0.3):
            direct_companies = self.query_tally_companies_direct()
            if direct_companies:
                if not self.active_company or self.active_company not in direct_companies:
                    self.active_company = direct_companies[0]
                return {"ok": True, "companies": direct_companies, "active_company": self.active_company}

        # 2. Query via MCP server with proper fields schema
        res = self.call_tool("list-master", {"collection": "company", "fields": ["Name", "IsActiveCompany"]}, timeout=15)
        if res.get("ok"):
            data = res.get("data", {})
            companies = []
            if isinstance(data, dict) and "list" in data:
                companies = [c.get("Name", c) if isinstance(c, dict) else str(c) for c in data["list"]]
            elif isinstance(data, list):
                companies = [c.get("Name", c) if isinstance(c, dict) else str(c) for c in data]

            clean_comps = [c.strip() for c in companies if isinstance(c, str) and c.strip()]
            if clean_comps:
                if not self.active_company or self.active_company not in clean_comps:
                    self.active_company = clean_comps[0]
                return {"ok": True, "companies": clean_comps, "active_company": self.active_company}

        # 3. Fallback: try query-collection tool
        res_coll = self.call_tool("query-collection", {"collection": "Company", "fields": ["Name"]}, timeout=10)
        if res_coll.get("ok"):
            table_id = res_coll.get("data", {}).get("tableID")
            if table_id:
                sql_res = self.call_tool("query-database", {"sql": f'SELECT "Name" FROM {table_id}'}, timeout=8)
                if sql_res.get("ok"):
                    rows = sql_res.get("data", [])
                    comps = [r.get("Name") for r in rows if isinstance(r, dict) and r.get("Name")]
                    if comps:
                        if not self.active_company or self.active_company not in comps:
                            self.active_company = comps[0]
                        return {"ok": True, "companies": comps, "active_company": self.active_company}

        return {"ok": True, "companies": [], "active_company": self.active_company, "notice": "No loaded companies found"}

    def set_active_company(self, company_name: str) -> Dict[str, Any]:
        """Sets and verifies active company context in TallyPrime."""
        clean_name = (company_name or "").strip()
        if not clean_name:
            return {"ok": False, "error": "Company name cannot be blank"}

        # First verify company exists in open companies
        comp_res = self.list_companies()
        if comp_res.get("ok"):
            companies = comp_res.get("companies", [])
            names = [c if isinstance(c, str) else c.get("name", c.get("Name", "")) for c in companies]
            if clean_name not in names and companies:
                return {
                    "ok": False,
                    "error": f"Company '{clean_name}' is not currently loaded in Tally. Open companies: {', '.join(names)}"
                }

        # Call set-company tool
        set_res = self.call_tool("set-company", {"company": clean_name})
        if set_res.get("ok"):
            self.active_company = clean_name
            return {"ok": True, "active_company": clean_name}

        # Even if set-company tool had a soft notice, remember company context for queries
        self.active_company = clean_name
        return {"ok": True, "active_company": clean_name, "notice": set_res.get("error")}

    def get_company_masters(self, company_name: Optional[str] = None) -> Dict[str, Any]:
        """Retrieves Ledgers, Groups, and VoucherTypes for the target company."""
        target = company_name or self.active_company
        args = {"targetCompany": target} if target else {}

        # 1. Fetch Ledgers with required fields
        ledgers_res = self.call_tool("list-master", {**args, "collection": "ledger", "fields": ["Name", "Parent", "_PrimaryGroup", "ClosingBalance"]}, timeout=20)
        # 2. Fetch Groups with required fields
        groups_res = self.call_tool("list-master", {**args, "collection": "group", "fields": ["Name", "Parent"]}, timeout=20)
        # 3. Fetch VoucherTypes with required fields
        vch_types_res = self.call_tool("list-master", {**args, "collection": "vouchertype", "fields": ["Name", "Parent"]}, timeout=20)

        def extract_list(r):
            if not r.get("ok"): return []
            d = r.get("data", {})
            if isinstance(d, dict) and "list" in d: return d["list"]
            if isinstance(d, list): return d
            return []

        ledgers = extract_list(ledgers_res)
        groups = extract_list(groups_res)
        vch_types = extract_list(vch_types_res)

        return {
            "ok": True,
            "company": target,
            "ledgers": ledgers,
            "groups": groups,
            "voucher_types": vch_types,
            "counts": {
                "ledgers": len(ledgers),
                "groups": len(groups),
                "voucher_types": len(vch_types)
            }
        }

    def get_bank_ledgers(self, company_name: Optional[str] = None) -> List[str]:
        """Retrieves list of bank ledgers nested under Bank Accounts / OD / OCC or matching bank names."""
        target = company_name or self.active_company
        args = {"targetCompany": target} if target else {}

        # 1. Try querying collection directly for exact parent groups
        try:
            coll_res = self.call_tool("query-collection", {
                "collection": "Ledger",
                "fields": ["Name", "Parent", "_PrimaryGroup"],
                **args
            }, timeout=15)
            if coll_res.get("ok"):
                table_id = coll_res.get("data", {}).get("tableID")
                if table_id:
                    q = chr(34)
                    sql = f'SELECT {q}Name{q} FROM {table_id} WHERE {q}Parent{q} IN (\'Bank Accounts\', \'Bank OCC A/c\', \'Bank OD A/c\') OR {q}_PrimaryGroup{q} IN (\'Bank Accounts\', \'Bank OCC A/c\', \'Bank OD A/c\')'
                    db_res = self.call_tool("query-database", {"sql": sql}, timeout=10)
                    if db_res.get("ok"):
                        rows = db_res.get("data", [])
                        names = [r.get("Name") for r in rows if r.get("Name")]
                        if names:
                            return names
        except Exception as e:
            logger.warning(f"Failed to query bank collection directly: {e}")

        # 2. Fallback to scanning all ledgers for Bank indicators
        try:
            masters = self.get_company_masters(target)
            all_ledgers = masters.get("ledgers", [])
            bank_ledgers = []
            for l in all_ledgers:
                name = l if isinstance(l, str) else l.get("name", "")
                if not name:
                    continue
                n_low = name.lower()
                if "bank" in n_low or any(k in n_low for k in ("sbi", "hdfc", "icici", "axis", "kotak", "pnb", "bob", "canara", "current a/c", "od a/c")):
                    bank_ledgers.append(name)
            if bank_ledgers:
                return bank_ledgers
        except Exception as e:
            logger.warning(f"Fallback ledger scan failed: {e}")

        return ["Bank  A/c"] if "Bank  A/c" in (all_ledgers if 'all_ledgers' in locals() else []) else []

    def get_ledger_balance(self, ledger_name: str, to_date: str, target_company: Optional[str] = None) -> Dict[str, Any]:
        """Queries Tally closing ledger balance for a given ledger and date."""
        target = target_company or self.active_company
        args = {
            "ledgerName": ledger_name,
            "toDate": to_date
        }
        if target:
            args["targetCompany"] = target

        res = self.call_tool("ledger-balance", args, timeout=15)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error", "Failed to retrieve ledger balance")}
        data = res.get("data", {})
        if isinstance(data, dict) and "amount" in data:
            return {"ok": True, "amount": float(data["amount"]), "company": target, "ledger": ledger_name}
        return {"ok": True, "amount": 0.0, "company": target, "ledger": ledger_name, "raw": data}

    def terminate(self):
        """Safely terminates child process and clears resources."""
        with self.proc_lock:
            if self.proc:
                try:
                    if self.proc.stdin:
                        self.proc.stdin.close()
                    if self.proc.stdout:
                        self.proc.stdout.close()
                    if self.proc.stderr:
                        self.proc.stderr.close()
                except Exception:
                    pass
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=2)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                self.proc = None
            self.is_initialized = False
