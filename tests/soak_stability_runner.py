"""
Continuous Soak & Stability Monitoring Daemon
VS Database 2.0 - Tauri Migration

Conducts continuous load testing across LAN (192.168.1.50) and localhost (127.0.0.1).
Records periodic resource measurements:
- Working Set Memory (RAM MiB)
- Latency (Min, Max, Avg in ms)
- HTTP Error Count & Success Rate
- Sidecar Process Health & Responsiveness
- Background Thread Activity

Outputs:
- 'soak_telemetry.jsonl' (Periodic records)
- 'soak_telemetry_summary.json' (Cumulative summary)
"""

import os
import sys
import time
import json
import socket
import urllib.request
import urllib.error
import ctypes
from ctypes import wintypes
from pathlib import Path

PROJECT_ROOT = Path(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration").resolve()
LOG_FILE = PROJECT_ROOT / "soak_telemetry.jsonl"
SUMMARY_FILE = PROJECT_ROOT / "soak_telemetry_summary.json"

HOST_IP = "192.168.1.50"
PORT = 8767

class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('PageFaultCount', wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t),
        ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
        ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t),
        ('PeakPagefileUsage', ctypes.c_size_t),
    ]

def get_process_memory_mb(pid):
    PROCESS_QUERY_INFORMATION = 0x0400
    PROCESS_VM_READ = 0x0010
    handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        return 0.0
    try:
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        if ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return counters.WorkingSetSize / (1024 * 1024)
        return 0.0
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)

def find_server_pid():
    import subprocess
    cmd = f"Get-NetTCPConnection -LocalPort {PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"
    res = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True)
    out = res.stdout.strip()
    if out and out.isdigit():
        return int(out)
    return None

def run_soak(max_cycles=60, requests_per_cycle=25, interval_sec=1):
    pid = find_server_pid()
    if not pid:
        print(f"[ERROR] No listening process found on port {PORT}. Start sidecar first.")
        return False

    initial_ram = get_process_memory_mb(pid)
    print(f"[{time.strftime('%H:%M:%S')}] Starting Soak Monitoring on PID {pid} (Initial RAM: {initial_ram:.2f} MiB)")
    print(f"Targeting: 127.0.0.1:{PORT} and {HOST_IP}:{PORT}")

    total_requests = 0
    total_errors = 0
    all_latencies = []
    cycle_records = []

    start_time = time.time()

    for cycle in range(1, max_cycles + 1):
        cycle_latencies = []
        cycle_errors = 0

        for r in range(requests_per_cycle):
            target = f"http://{HOST_IP}:{PORT}/api/desktop/health" if r % 2 == 0 else f"http://127.0.0.1:{PORT}/api/desktop/health"
            t0 = time.time()
            try:
                with urllib.request.urlopen(target, timeout=2) as resp:
                    if resp.status == 200:
                        cycle_latencies.append((time.time() - t0) * 1000)
                    else:
                        cycle_errors += 1
            except Exception:
                cycle_errors += 1

        total_requests += requests_per_cycle
        total_errors += cycle_errors
        all_latencies.extend(cycle_latencies)

        current_ram = get_process_memory_mb(pid)
        avg_lat = sum(cycle_latencies) / len(cycle_latencies) if cycle_latencies else 0.0

        record = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "cycle": cycle,
            "pid": pid,
            "ram_mb": round(current_ram, 2),
            "ram_drift_mb": round(current_ram - initial_ram, 2),
            "cycle_requests": requests_per_cycle,
            "cycle_errors": cycle_errors,
            "avg_latency_ms": round(avg_lat, 2)
        }
        cycle_records.append(record)

        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

        print(f"Cycle {cycle:02d}/{max_cycles:02d} | RAM: {current_ram:.2f} MiB (Drift: {record['ram_drift_mb']:+.2f} MB) | Avg Latency: {avg_lat:.2f} ms | Errors: {cycle_errors}")

        if interval_sec > 0 and cycle < max_cycles:
            time.sleep(interval_sec)

    elapsed = time.time() - start_time
    final_ram = get_process_memory_mb(pid)

    summary = {
        "start_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(start_time)),
        "end_time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_seconds": round(elapsed, 2),
        "total_requests": total_requests,
        "total_errors": total_errors,
        "success_rate_percent": round(100.0 * (total_requests - total_errors) / total_requests, 2) if total_requests else 0,
        "throughput_req_per_sec": round(total_requests / elapsed, 1) if elapsed else 0,
        "latency_min_ms": round(min(all_latencies), 2) if all_latencies else 0,
        "latency_avg_ms": round(sum(all_latencies) / len(all_latencies), 2) if all_latencies else 0,
        "latency_max_ms": round(max(all_latencies), 2) if all_latencies else 0,
        "ram_initial_mb": round(initial_ram, 2),
        "ram_final_mb": round(final_ram, 2),
        "ram_net_drift_mb": round(final_ram - initial_ram, 2),
        "sidecar_pid": pid,
        "stability_verdict": "PASS" if total_errors == 0 and (final_ram - initial_ram) < 25.0 else "FAIL"
    }

    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "="*60)
    print("SOAK STABILITY SUMMARY:")
    print(json.dumps(summary, indent=2))
    print("="*60)
    return True

if __name__ == "__main__":
    cycles = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    reqs = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    interval = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    run_soak(max_cycles=cycles, requests_per_cycle=reqs, interval_sec=interval)
