import pefile
import ctypes
import os
import sys

ctypes.windll.kernel32.GetProcAddress.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
ctypes.windll.kernel32.GetProcAddress.restype = ctypes.c_void_p
ctypes.windll.kernel32.LoadLibraryExW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_uint32]
ctypes.windll.kernel32.LoadLibraryExW.restype = ctypes.c_void_p

exe = sys.argv[1] if len(sys.argv) > 1 else r"src-tauri\target\debug\vs-database.exe"
if not os.path.exists(exe):
    print(f"Exe not found: {exe}")
    sys.exit(1)

pe = pefile.PE(exe, fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])

missing_total = []

print(f"Scanning imports of: {exe}")
for entry in pe.DIRECTORY_ENTRY_IMPORT:
    dll_name = entry.dll.decode("utf-8", errors="ignore")
    dll_path = os.path.join(r"src-tauri\target\debug", dll_name) if dll_name.lower() == "webview2loader.dll" else dll_name
    h = ctypes.windll.kernel32.LoadLibraryExW(dll_path, None, 0)
    if not h:
        err = ctypes.GetLastError()
        print(f"[DLL LOAD ERROR] {dll_name} failed to load: {err}")
        missing_total.append((dll_name, "DLL_NOT_FOUND"))
        continue
    
    missing_funcs = []
    for imp in entry.imports:
        if imp.name:
            fname = imp.name.decode("utf-8", errors="ignore")
            addr = ctypes.windll.kernel32.GetProcAddress(h, fname.encode("ascii"))
            if not addr:
                missing_funcs.append(fname)
        elif imp.ordinal:
            addr = ctypes.windll.kernel32.GetProcAddress(h, ctypes.cast(imp.ordinal, ctypes.c_char_p))
            if not addr:
                missing_funcs.append(f"Ordinal_{imp.ordinal}")
                
    if missing_funcs:
        print(f"[SYMBOL ERROR] {dll_name} MISSING ({len(missing_funcs)}): {missing_funcs}")
        missing_total.extend([(dll_name, f) for f in missing_funcs])
    else:
        print(f"[OK] {dll_name}: All {len(entry.imports)} imports resolved")

print(f"\nScan complete. Total missing symbols: {len(missing_total)}")
