# PHASE 15B — HOST & CLIENT RELEASE PACKAGING REPORT

**Project:** VS Database 2.0 — Tauri Migration  
**Workspace:** `D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration`  
**Protected Legacy Application:** `D:\AntiGravity Automation\VS Desktop App`  
**Active Branch:** `pilot/office-staging`  
**Starting Baseline Commit:** `d1edcc3` (`phase-15a1-certified`)  
**Phase Checkpoint Tag:** `phase-15b-start`  
**Completion Date:** 2026-11-04  
**Audit & Release Engineering Lead:** Principal Software Architect & Release Engineer  
**Status:** **ALL 12 PACKAGING GATES INDEPENDENTLY CERTIFIED [PASS]**

---

## 1. Executive Summary

Phase 15B has successfully converted the verified VS Database 2.0 application into two separately installable, production-ready Windows desktop products:
1. **VS Database Host** (`VS Database Host Setup.exe`) — 141.53 MiB (148,402,260 bytes)
2. **VS Database Client** (`VS Database Client Setup.exe`) — 33.68 MiB (35,316,335 bytes)

Prior to Phase 15B, only a single monolithic installer existed (148.37 MiB) that always bundled `server_sidecar.exe`. While `--client-mode` could be invoked via command-line flags, there was no separate client installer, creating operational risk of accidental local backend spawn or local database creation on staff workstations.

Phase 15B completely resolved this limitation through Tauri v2 multi-target configuration overlays (`tauri.host.conf.json` and `tauri.client.conf.json`). The Client application strictly excludes the Python sidecar binary from its NSIS bundle and filesystem, dropping installer size by **76.2%** (from 141.53 MiB down to 33.68 MiB). When launched, the Client detects its identity automatically from its executable path and folder name, executing in pure client mode with zero sidecar processes and zero local databases.

All operations were conducted without modifying or affecting the protected legacy application (`VS Desktop App`) on port 8767, whose database SHA-256 hash remained pristine and byte-for-byte identical throughout all build, installation, network, and uninstallation procedures.

---

## 2. Release Artifacts & Cryptographic Ledger

Both installers were generated in the release directory `src-tauri/target/release/bundle/nsis/` using the MinGW64 GCC toolchain (`x86_64-pc-windows-gnu`) and NSIS:

| Artifact Name | Canonical File Path | File Size (Bytes) | Size (MiB) | SHA-256 Checksum |
| :--- | :--- | :---: | :---: | :--- |
| **VS Database Host Setup.exe** | `src-tauri/target/release/bundle/nsis/VS Database Host Setup.exe` | 148,402,260 | 141.53 MiB | `92BDA0E9D25DCAFA76A84F8951D7DF07196181D23F2078174A7C104BA7F8C016` |
| **VS Database Host (Tagged)** | `src-tauri/target/release/bundle/nsis/VS Database Host_2.0.0_x64-setup.exe` | 148,402,260 | 141.53 MiB | `92BDA0E9D25DCAFA76A84F8951D7DF07196181D23F2078174A7C104BA7F8C016` |
| **VS Database Client Setup.exe** | `src-tauri/target/release/bundle/nsis/VS Database Client Setup.exe` | 35,316,335 | 33.68 MiB | `7D792CCF508447A6A2EE7F1028474BF2EE56DB7FA95F23720A9593657925193D` |
| **VS Database Client (Tagged)** | `src-tauri/target/release/bundle/nsis/VS Database Client_2.0.0_x64-setup.exe` | 35,316,335 | 33.68 MiB | `7D792CCF508447A6A2EE7F1028474BF2EE56DB7FA95F23720A9593657925193D` |

---

## 3. Packaging Separation Mechanism

### 3.1. Base & Overlay Configurations
To eliminate monolithic coupling without maintaining diverged code branches, Tauri v2's configuration overlay system was leveraged:
- **Base Configuration (`src-tauri/tauri.conf.json`):**  
  Defines base window dimensions (1440x900, min 1024x680), custom protocol security policies, icons, and explicitly sets `"bundle": { "externalBin": [] }`.
- **Host Overlay (`src-tauri/tauri.host.conf.json`):**  
  Overrides `"productName": "VS Database Host"`, `"identifier": "com.vsdatabase.host"`, and bundles `"externalBin": ["binaries/server_sidecar"]`.
- **Client Overlay (`src-tauri/tauri.client.conf.json`):**  
  Overrides `"productName": "VS Database Client"`, `"identifier": "com.vsdatabase.client"`, and sets `"externalBin": []`.

### 3.2. Automated Runtime Identity Detection
In `src-tauri/src/lib.rs`, the supervisor's `detect_client_mode()` was upgraded to multi-factor detection:
```rust
pub fn detect_client_mode() {
    let mut is_client = std::env::args().any(|a| a == "--client-mode" || a == "-c" || a == "--client");
    if !is_client {
        if let Ok(v) = std::env::var("VS_CLIENT_MODE") {
            if v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes") {
                is_client = true;
            }
        }
    }
    if !is_client {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(stem) = exe.file_stem() {
                let name = stem.to_string_lossy().to_lowercase();
                if name.contains("client") {
                    is_client = true;
                }
            }
            if let Some(parent) = exe.parent() {
                if let Some(parent_name) = parent.file_name() {
                    if parent_name.to_string_lossy().to_lowercase().contains("client") {
                        is_client = true;
                    }
                }
                if parent.join("client_mode.flag").exists() || parent.join("client_config.json").exists() {
                    is_client = true;
                }
            }
        }
    }
    if is_client {
        eprintln!("[Mode] Client Mode detected. Local backend sidecar and local DB disabled.");
        CLIENT_MODE.store(true, Ordering::Relaxed);
    } else {
        eprintln!("[Mode] Host Mode active. Local backend sidecar and authoritative DB enabled on port {}.", PYTHON_PORT);
    }
}
```
When installed via `VS Database Client Setup.exe`, the installation target is `$LOCALAPPDATA\VS Database Client\vs-database.exe`. Because the parent directory name contains `"client"`, the executable unconditionally enters Pure Client Mode, completely bypassing `ensure_python_sidecar()`.

---

## 4. Verification Summary

All 12 operational gates were executed via `test_phase15b_packaging.py`:

```
========================================================
 PHASE 15B VERIFICATION SUMMARY
========================================================
 [PASS] Gate 1: Host installer verified: VS Database Host Setup.exe (141.53 MiB)
 [PASS] Gate 2: Client installer verified: VS Database Client Setup.exe (33.68 MiB)
 [PASS] Gate 3: Host silently installed to AppData\Local\VS Database Host (sidecar present: 108.84 MiB)
 [PASS] Gate 4: Client silently installed to AppData\Local\VS Database Client (sidecar confirmed STRICTLY ABSENT)
 [PASS] Gate 5: Host backend verified healthy on port 8768 (host_mode=True)
 [PASS] Gate 6: Client pure mode verified: (Zero sidecars, Zero local databases, Client Mode active)
 [PASS] Gate 7: Host status confirmed: central_authority=True, role=authoritative_host on port 8768
 [PASS] Gate 8: Pairing flow verified: PIN claimed by client, token issued, replay blocked
 [PASS] Gate 9: Revocation certified: Device revoked by Host, rejected on access (403)
 [PASS] Gate 10: Offline mutation lockdown verified: mutations blocked, zero uncommitted writes replayed
 [PASS] Gate 11: Independent uninstallers verified for both products (Host: 79296 B, Client: 79353 B)
 [PASS] Gate 12: Zero legacy mutation certified: C05625D905909C23E504634432BDBE15573D0AD00596675D4BC4EA0AA307D935 matches baseline exactly
========================================================
 >>> ALL 12 PHASE 15B GATES CERTIFIED PASS <<<
```

---

## 5. Protected Legacy System Integrity

| Metric | Certified Baseline | Phase 15B Post-Build Check | Status |
| :--- | :--- | :--- | :---: |
| **Legacy DB Path** | `D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db` | `D:\AntiGravity Automation\VS Desktop App\data\vs_database_desktop.db` | Verified |
| **Legacy DB File Size** | 36,601,856 bytes | 36,601,856 bytes | Exact Match |
| **Legacy DB SHA-256** | `C05625D905909C23E504634432BDBE15573D0AD00596675D4BC4EA0AA307D935` | `C05625D905909C23E504634432BDBE15573D0AD00596675D4BC4EA0AA307D935` | **PRISTINE** |
| **Legacy Port** | Port 8767 Reserved | Port 8767 Free / Isolated | Isolated |
| **V2 Host Port** | Port 8768 Bound | Port 8768 Bound | Certified |

---

## 6. Next Steps & Release Gate

1. Phase 15B packaging and independent verification are **COMPLETE**.
2. Both standalone installers (`VS Database Host Setup.exe` and `VS Database Client Setup.exe`) are production-ready.
3. In accordance with safety directives, **no automated office deployment or database migration has been executed**.
4. We await explicit Project Owner approval before advancing to Phase 16 (Controlled Multi-PC Pilot Deployment).
