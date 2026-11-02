import time
import os
import sys
import ctypes
from ctypes import wintypes
import urllib.request
import json
from pathlib import Path

def get_process_memory():
    try:
        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        if ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return counters.WorkingSetSize / (1024 * 1024)
    except Exception:
        pass
    return 0.0

def run_benchmark():
    m0 = get_process_memory()
    t0 = time.perf_counter()
    print(f"[Bench] Initial memory: {m0:.2f} MB")

    t_import_start = time.perf_counter()
    import server
    t_import_end = time.perf_counter()
    m_import = get_process_memory()
    print(f"[Bench] 'import server' took {(t_import_end - t_import_start)*1000:.2f} ms (Mem: {m_import:.2f} MB, Delta: +{m_import - m0:.2f} MB)")

    port = 8792
    t_start_start = time.perf_counter()
    server.start_server_background(port=port, host="127.0.0.1")
    t_start_end = time.perf_counter()
    print(f"[Bench] 'server.start_server_background' took {(t_start_end - t_start_start)*1000:.2f} ms")

    endpoints = [
        f"http://127.0.0.1:{port}/api/desktop/health",
        f"http://127.0.0.1:{port}/api/auth/status",
        f"http://127.0.0.1:{port}/api/clients",
        f"http://127.0.0.1:{port}/api/settings",
    ]

    for ep in endpoints:
        t_req_start = time.perf_counter()
        try:
            req = urllib.request.Request(ep)
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = resp.read()
                t_req_end = time.perf_counter()
                print(f"[Bench] GET {ep} -> {resp.status} in {(t_req_end - t_req_start)*1000:.2f} ms (bytes: {len(data)})")
        except Exception as e:
            t_req_end = time.perf_counter()
            print(f"[Bench] GET {ep} FAILED in {(t_req_end - t_req_start)*1000:.2f} ms: {e}")

    m_final = get_process_memory()
    print(f"[Bench] Total time: {(time.perf_counter() - t0)*1000:.2f} ms, Final Mem: {m_final:.2f} MB (Total Delta: +{m_final - m0:.2f} MB)")

    server.stop_server()

if __name__ == "__main__":
    run_benchmark()
