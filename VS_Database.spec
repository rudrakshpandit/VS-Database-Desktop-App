# -*- mode: python ; coding: utf-8 -*-


from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

webview_datas = collect_data_files('webview')
webview_binaries = collect_dynamic_libs('webview')
webview_submodules = collect_submodules('webview')

import os
import webview
lib_dir = os.path.join(os.path.dirname(webview.__file__), 'lib')
extra_binaries = [
    (os.path.join(lib_dir, 'Microsoft.Web.WebView2.Core.dll'), '.'),
    (os.path.join(lib_dir, 'Microsoft.Web.WebView2.WinForms.dll'), '.'),
    (os.path.join(lib_dir, 'WebBrowserInterop.x64.dll'), '.'),
    (os.path.join(lib_dir, 'WebBrowserInterop.x86.dll'), '.'),
    (os.path.join(lib_dir, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'), '.'),
    (os.path.join(lib_dir, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'), 'runtimes/win-x64/native'),
    (os.path.join(lib_dir, 'runtimes', 'win-x86', 'native', 'WebView2Loader.dll'), 'runtimes/win-x86/native'),
]

a = Analysis(
    ['main_app.py'],
    pathex=[],
    binaries=webview_binaries + extra_binaries,
    datas=[('static', 'static')] + webview_datas,
    hiddenimports=['webview', 'clr', 'pythonnet', 'server', 'staging_manager', 'pdf_studio_engine', 'vs_ai_engine', 'pymupdf', 'fitz', 'PIL', 'reportlab', 'pypdf'] + webview_submodules,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='VS_Database',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['static/app_icon.ico'],
)
