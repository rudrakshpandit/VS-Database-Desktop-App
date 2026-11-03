import subprocess
import time
import json
import urllib.request
from pathlib import Path

exe_path = Path("src-tauri/target/release/vs-database.exe").resolve()
print(f"Testing release executable: {exe_path}")
assert exe_path.is_file(), f"Release executable not found: {exe_path}"

# Launch release binary
proc = subprocess.Popen([str(exe_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print(f"Spawned PID: {proc.pid}")

try:
    # Wait up to 10 seconds for startup and backend readiness
    ready = False
    for i in range(15):
        time.sleep(1)
        ret = proc.poll()
        if ret is not None:
            stdout, stderr = proc.communicate()
            print(f"[FAIL] Executable exited prematurely with code {ret}")
            print(f"STDOUT: {stdout.decode(errors='ignore')}")
            print(f"STDERR: {stderr.decode(errors='ignore')}")
            break
        
        try:
            req = urllib.request.Request("http://127.0.0.1:8767/api/desktop/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode())
                if data.get("ok"):
                    print(f"[SUCCESS] Backend responded healthy at attempt {i+1}: {data}")
                    ready = True
                    break
        except Exception as e:
            # Still starting
            pass

    if ready:
        print("[VERIFIED] Tauri 2 Release Executable + Sidecar fully operational!")
        # Test lifecycle policy endpoint
        try:
            req2 = urllib.request.Request("http://127.0.0.1:8767/api/desktop/lifecycle-policy")
            with urllib.request.urlopen(req2, timeout=2) as resp2:
                policy = json.loads(resp2.read().decode())
                print(f"[VERIFIED] Lifecycle policy endpoint responded: {policy}")
        except Exception as e:
            print(f"Lifecycle policy check failed: {e}")
finally:
    print("Terminating test process cleanly...")
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    print("Process stopped.")
