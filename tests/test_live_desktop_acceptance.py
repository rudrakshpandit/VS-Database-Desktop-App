import ctypes
from ctypes import wintypes
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
EXE_PATH = APP_DIR / "VS_Database.exe"
STATE_FILE = APP_DIR / "data" / "window_state.json"
PORT = 8767


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


user32 = ctypes.windll.user32


def wait_for_desktop_ready(timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/desktop/state")
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    ui = data.get("ui") or {}
                    hwnd = ui.get("hwnd")
                    if ui.get("attached") and hwnd and user32.IsWindow(int(hwnd)):
                        return data
        except Exception:
            pass
        time.sleep(0.35)
    raise RuntimeError(f"VS_Database.exe did not attach UI window within {timeout}s")


def wait_for_process_exit(proc: subprocess.Popen, timeout: float = 12.0):
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
    # Ensure port 8767 is free before next launch
    deadline = time.time() + 6.0
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/desktop/health")
            with urllib.request.urlopen(req, timeout=0.4):
                time.sleep(0.25)
        except Exception:
            break


def get_win_rect(hwnd: int) -> tuple[int, int, int, int]:
    rc = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rc))
    return (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top)


def post_json(path: str, payload: dict, timeout: float = 30.0) -> tuple[int, bytes, dict]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read(), dict(resp.headers)


def run_live_acceptance():
    print("=" * 78)
    print("VS DATABASE — LIVE DESKTOP EXECUTABLE (VS_Database.exe) ACCEPTANCE SUITE")
    print("=" * 78)
    assert EXE_PATH.is_file(), f"Missing {EXE_PATH}"

    env = os.environ.copy()
    env["VS_AUTO_CONFIRM_CLOSE"] = "1"

    # Clean initial window_state.json to test first launch -> resize/reposition
    if STATE_FILE.exists():
        STATE_FILE.unlink()

    # -------------------------------------------------------------------------
    # LAUNCH 1: First launch -> Resize & Reposition -> Close
    # -------------------------------------------------------------------------
    print("\n[Launch 1] Starting VS_Database.exe (First launch -> Resize & Reposition to 140, 95, 1280x760)...")
    proc1 = subprocess.Popen([str(EXE_PATH)], cwd=str(APP_DIR), env=env)
    try:
        st1 = wait_for_desktop_ready()
        hwnd1 = int(st1["ui"]["hwnd"])
        time.sleep(0.8)  # Allow window_state_ready event (0.15s) to arm
        assert user32.IsWindowVisible(hwnd1), "Window 1 is not visible"
        assert not user32.IsIconic(hwnd1), "Window 1 should not be iconic"

        SWP_NOZORDER = 0x0004
        user32.SetWindowPos(hwnd1, 0, 140, 95, 1280, 760, SWP_NOZORDER)
        time.sleep(0.6)
        l1, t1, w1, h1 = get_win_rect(hwnd1)
        print(f"  Live HWND={hwnd1} moved/resized to x={l1}, y={t1}, w={w1}, h={h1}")

        WM_CLOSE = 0x0010
        user32.PostMessageW(hwnd1, WM_CLOSE, 0, 0)
    finally:
        wait_for_process_exit(proc1)

    assert STATE_FILE.is_file(), "window_state.json was not created on close!"
    saved1 = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    print(f"  Saved window_state.json after Launch 1: {saved1}")
    assert saved1["maximized"] is False, f"Expected maximized=False, got {saved1}"
    assert abs(saved1["width"] - 1280) <= 16 and abs(saved1["height"] - 760) <= 16, f"Bounds mismatch: {saved1}"
    assert abs(saved1["x"] - 140) <= 16 and abs(saved1["y"] - 95) <= 16, f"Position mismatch: {saved1}"
    print("  [PASS] Launch 1: Normal resize & reposition persisted accurately.")

    # -------------------------------------------------------------------------
    # LAUNCH 2: Relaunch -> Verify Normal Bounds Restored -> Maximize -> Close
    # -------------------------------------------------------------------------
    print("\n[Launch 2] Relaunching VS_Database.exe (Verify 1280x760 @ 140,95 restored -> Maximize -> Close)...")
    proc2 = subprocess.Popen([str(EXE_PATH)], cwd=str(APP_DIR), env=env)
    try:
        st2 = wait_for_desktop_ready()
        hwnd2 = int(st2["ui"]["hwnd"])
        time.sleep(0.8)
        l2, t2, w2, h2 = get_win_rect(hwnd2)
        print(f"  Restored HWND={hwnd2} geometry: x={l2}, y={t2}, w={w2}, h={h2}")
        assert not user32.IsZoomed(hwnd2), "Window 2 should have restored to normal (unmaximized) state"
        assert abs(w2 - 1280) <= 16 and abs(h2 - 760) <= 16, f"Restored size mismatch: {w2}x{h2}"
        assert abs(l2 - 140) <= 16 and abs(t2 - 95) <= 16, f"Restored position mismatch: {l2},{t2}"

        # Now maximize the live window
        SW_MAXIMIZE = 3
        user32.ShowWindow(hwnd2, SW_MAXIMIZE)
        time.sleep(0.8)
        assert user32.IsZoomed(hwnd2), "Window 2 failed to maximize via ShowWindow(SW_MAXIMIZE)"

        WM_CLOSE = 0x0010
        user32.PostMessageW(hwnd2, WM_CLOSE, 0, 0)
    finally:
        wait_for_process_exit(proc2)

    saved2 = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    print(f"  Saved window_state.json after Launch 2 (Maximized): {saved2}")
    assert saved2["maximized"] is True, f"Expected maximized=True after closing maximized window, got {saved2}"
    assert abs(saved2["width"] - 1280) <= 16 and abs(saved2["height"] - 760) <= 16, (
        f"Normal bounds were overwritten when maximizing: {saved2}"
    )
    print("  [PASS] Launch 2: Previous normal bounds restored, and maximized state + normal bounds persisted.")

    # -------------------------------------------------------------------------
    # LAUNCH 3: Relaunch -> Verify Maximized Restored + Live HTTP API Checks -> Minimize -> Close
    # -------------------------------------------------------------------------
    print("\n[Launch 3] Relaunching VS_Database.exe (Verify Maximized Restored + Live HTTP Endpoints + Minimize -> Close)...")
    proc3 = subprocess.Popen([str(EXE_PATH)], cwd=str(APP_DIR), env=env)
    try:
        st3 = wait_for_desktop_ready()
        hwnd3 = int(st3["ui"]["hwnd"])
        time.sleep(0.8)
        is_max3 = bool(user32.IsZoomed(hwnd3))
        l3, t3, w3, h3 = get_win_rect(hwnd3)
        print(f"  Restored HWND={hwnd3}: IsZoomed={is_max3}, rect=({l3}, {t3}, {w3}x{h3})")
        assert is_max3, f"Window 3 did NOT reopen maximized! IsZoomed={is_max3}"
        print("  [PASS] Launch 3a: Window reopened in Maximized state.")

        # Test Live HTTP Export & Artifact Download Endpoints on running VS_Database.exe
        status_x, body_x, _ = post_json(
            "/api/ai/export-xlsx",
            {
                "title": "Live EXE GSTR-2B Reconciliation FY 2025-26",
                "content": "Generate a GSTR-2B vs Purchase Register reconciliation report in Excel and PDF with matched invoices, mismatched invoices, missing in 2B, missing in books, blocked ITC, and action summary.",
                "client_name": "M/s Apex Industrial Enterprises Pvt. Ltd.",
            },
        )
        assert status_x == 200, f"Live /api/ai/export-xlsx failed: {status_x}"
        res_x = json.loads(body_x.decode("utf-8"))
        assert res_x.get("ok") and res_x.get("artifact_id"), f"Invalid XLSX export response: {res_x}"
        art_id = res_x["artifact_id"]

        status_d, body_d, _ = post_json(
            "/api/ai/export-docx",
            {
                "title": "Live EXE Notice Reply FY 2025-26",
                "content": "Generate a comprehensive GST DRC-01 / Income-tax 143(1) / 148A(b) notice reply and audit observation response report in Word and PDF with issue summary, factual explanation, legal submission, reconciliation annexure summary, risk assessment, and prayer/conclusion.",
                "client_name": "M/s Apex Industrial Enterprises Pvt. Ltd.",
            },
        )
        assert status_d == 200, f"Live /api/ai/export-docx failed: {status_d}"
        res_d = json.loads(body_d.decode("utf-8"))
        assert res_d.get("ok") and res_d.get("artifact_id"), f"Invalid DOCX export response: {res_d}"

        status_p, body_p, _ = post_json(
            "/api/ai/export-pdf",
            {
                "title": "Live EXE Notice Reply FY 2025-26",
                "content": "Generate a comprehensive GST DRC-01 / Income-tax 143(1) / 148A(b) notice reply and audit observation response report in Word and PDF with issue summary, factual explanation, legal submission, reconciliation annexure summary, risk assessment, and prayer/conclusion.",
                "client_name": "M/s Apex Industrial Enterprises Pvt. Ltd.",
            },
        )
        assert status_p == 200, f"Live /api/ai/export-pdf failed: {status_p}"
        res_p = json.loads(body_p.decode("utf-8"))
        assert res_p.get("ok") and res_p.get("artifact_id"), f"Invalid PDF export response: {res_p}"

        # Test HTTP GET /api/ai/artifacts/<id>/download
        dl_req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/ai/artifacts/{art_id}/download")
        with urllib.request.urlopen(dl_req, timeout=10.0) as dl_resp:
            dl_bytes = dl_resp.read()
            assert dl_resp.status == 200 and len(dl_bytes) > 8000, f"Artifact download failed: { len(dl_bytes) } bytes"
        print(f"  [PASS] Launch 3b: Live HTTP XLSX/DOCX/PDF export & artifact download ({art_id}, {len(dl_bytes)} bytes) verified.")

        # Test Live SSE /api/ai/chat/stream Clarification Slide Generation & Answer Submission
        cid_live = f"live_exe_clarif_{int(time.time())}"
        status_c1, body_c1, _ = post_json(
            "/api/ai/chat/stream",
            {
                "conversation_id": cid_live,
                "prompt": "I received an income tax notice and want to draft a reply.",
                "generation_mode": "chat",
            },
        )
        sse_text_1 = body_c1.decode("utf-8", errors="replace")
        assert "```question" in sse_text_1 and "notice_type_section" in sse_text_1, (
            f"Expected clarification question slides on ambiguous notice prompt, got:\n{sse_text_1[:500]}"
        )
        print("  [PASS] Launch 3c: Live SSE /api/ai/chat/stream emitted sequential clarification slides cleanly.")

        # Now minimize the live window and close it
        SW_MINIMIZE = 6
        user32.ShowWindow(hwnd3, SW_MINIMIZE)
        time.sleep(0.5)
        assert user32.IsIconic(hwnd3), "Window 3 should be minimized (IsIconic)"
        WM_CLOSE = 0x0010
        user32.PostMessageW(hwnd3, WM_CLOSE, 0, 0)
    finally:
        wait_for_process_exit(proc3)

    saved3 = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    print(f"  Saved window_state.json after closing Minimized window: {saved3}")
    assert saved3["x"] > -1000 and saved3["y"] > -1000 and saved3["width"] >= 1080, (
        f"Minimized sentinel leaked into window_state.json: {saved3}"
    )

    # -------------------------------------------------------------------------
    # LAUNCH 4: Relaunch after Minimized Close -> Must be Visible & Usable (Not Iconic)
    # -------------------------------------------------------------------------
    print("\n[Launch 4] Relaunching VS_Database.exe after Minimized Close (Verify Visible & Not Minimized)...")
    proc4 = subprocess.Popen([str(EXE_PATH)], cwd=str(APP_DIR), env=env)
    try:
        st4 = wait_for_desktop_ready()
        hwnd4 = int(st4["ui"]["hwnd"])
        time.sleep(0.8)
        assert user32.IsWindowVisible(hwnd4), "Window 4 is not visible!"
        assert not user32.IsIconic(hwnd4), "Window 4 remained minimized (IsIconic) on relaunch!"
        l4, t4, w4, h4 = get_win_rect(hwnd4)
        print(f"  Restored HWND={hwnd4}: Visible=True, IsIconic=False, IsZoomed={bool(user32.IsZoomed(hwnd4))}, rect=({l4},{t4},{w4}x{h4})")
        assert w4 >= 1080 and h4 >= 700, f"Invalid window dimensions on Launch 4: {w4}x{h4}"
        print("  [PASS] Launch 4: Window reopened visible and usable after minimized close.")

        WM_CLOSE = 0x0010
        user32.PostMessageW(hwnd4, WM_CLOSE, 0, 0)
    finally:
        wait_for_process_exit(proc4)

    print("\n" + "=" * 78)
    print("ALL 4 LIVE DESKTOP EXECUTABLE LAUNCHES & ENDPOINT VERIFICATIONS PASSED!")
    print("=" * 78)


if __name__ == "__main__":
    run_live_acceptance()
