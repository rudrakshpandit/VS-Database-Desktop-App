# -*- mode: python ; coding: utf-8 -*-

import os
import sys

block_cipher = None

datas = []

hiddenimports = [
    'staging_manager',
    'pdf_studio_engine',
    'vs_ai_engine',
    'vs_ai_clarification',
    'vs_ai_doc_generator',
    'vs_ai_rename',
    'automation_engine',
    'statement_parser',
    'automation_db',
    'tally_mcp_client',
    'openpyxl',
    'docx',
    'pptx',
    'formulas',
    'docxtpl',
    'jinja2',
    'docir_models',
    'style_profile_engine',
    'doc_validator',
    'template_engine',
    'deterministic_generators',
    'doc_recovery',
    'docir_builder',
    'qrcode',
    'pymupdf',
    'fitz',
    'PIL',
    'reportlab',
    'pypdf',
    'google_auth_oauthlib',
    'google_auth_oauthlib.flow',
    'google.oauth2',
    'google.oauth2.credentials',
    'googleapiclient',
    'googleapiclient.discovery',
    'sqlite3',
    'json',
    'http.server',
    'socketserver',
    'urllib.parse',
    'threading',
    'secrets',
    'hashlib',
    'uuid',
    'time',
    'datetime',
]

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL._avif', '_avif', 'avif', 'webview', 'clr', 'pythonnet'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Filter out _avif which can cause issue on Python 3.14
a.binaries = [x for x in a.binaries if '_avif' not in x[0].lower()]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='server_sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True, # Console enabled for reliable logging and debugging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='static/app_icon.ico' if os.path.exists('static/app_icon.ico') else None,
)
