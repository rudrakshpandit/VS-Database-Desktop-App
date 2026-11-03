import subprocess
import time
import json
import urllib.request
from pathlib import Path

exe = Path("src-tauri/target/release/vs-database.exe").resolve()
print("Starting vs-database release:", exe)
p = subprocess.Popen([str(exe)])
root_pid = p.pid
print("Root PID:", root_pid)

try:
    # Wait for backend readiness
    ready = False
    for _ in range(20):
        time.sleep(0.3)
        try:
            with urllib.request.urlopen("http://127.0.0.1:8767/api/desktop/health", timeout=1) as r:
                if json.loads(r.read().decode()).get("ok"):
                    ready = True
                    break
        except Exception:
            pass

    print("Backend ready:", ready)
    time.sleep(2) # let memory settle

    # Fetch process tree via powershell CimInstance
    ps_cmd = f"""
    $all = Get-CimInstance Win32_Process
    $children = @()
    function Get-Tree($pids) {{
        $sub = $all | Where-Object {{ $pids -contains $_.ParentProcessId }}
        if ($sub) {{
            $script:children += $sub
            Get-Tree ($sub.ProcessId)
        }}
    }}
    Get-Tree @({root_pid})
    $res = @($all | Where-Object {{ $_.ProcessId -eq {root_pid} }}) + $children
    $res | Select-Object ProcessId, Name, WorkingSetSize | ConvertTo-Json
    """
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
    tree_data = json.loads(res.stdout)
    if isinstance(tree_data, dict):
        tree_data = [tree_data]

    total_bytes = 0
    print("\nExact Parent-Child Process Tree:")
    for proc in tree_data:
        pid = proc.get("ProcessId")
        name = proc.get("Name")
        ws = int(proc.get("WorkingSetSize", 0))
        total_bytes += ws
        print(f"  - {name} [PID {pid}]: {ws / (1024*1024):.2f} MB")

    total_mb = total_bytes / (1024 * 1024)
    print(f"\n[MEASURED] True Process-Tree Working Set: {total_mb:.2f} MB")
finally:
    p.terminate()
    try:
        p.wait(timeout=3)
    except Exception:
        p.kill()
    subprocess.run(["powershell", "-Command", "Get-Process -Name server_sidecar, vs-database -ErrorAction SilentlyContinue | Stop-Process -Force"], capture_output=True)
