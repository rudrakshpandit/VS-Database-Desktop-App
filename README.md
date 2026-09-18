# VS Database — Standalone Windows Desktop Application

A high-performance standalone Windows desktop application for client management, document filing, and PDF studio automation. Powered by Python, Microsoft WebView2 (Edge Chromium), and a local high-speed embedded HTTP service.

---

## Features

- **Standalone Windows Desktop Experience**: Native WebView2 shell with frameless or windowed support, fluent styling, and system tray / taskbar integration.
- **Save & Staging Workspace**: Seamlessly organize, preview, and route documents to client folders.
- **Full PDF Studio Engine**:
  - Rotate, Rearrange, Split, and Merge PDFs.
  - Watermark overlay (text & official VS logo image support).
  - Insert pages, delete pages, lock/unlock (AES-256 encryption).
  - Balanced multi-level compression.
- **Companion Chrome Extension**:
  - Intercepts downloads with non-blocking in-memory capture.
  - Single save and Bulk collector dock with keyboard shortcuts.
  - Automatic focus redirect between browser tabs and desktop application.
- **Isolated Port Architecture**: Dedicated standalone port (`8767`) with zero interference to other local services.

---

## Repository Structure

```
├── main_app.py               # Desktop application launcher & WebView2 host
├── server.py                 # Backend API, document storage & staging engine
├── staging_manager.py        # Durable FIFO staging queue manager
├── pdf_studio_engine.py      # PyMuPDF-based PDF manipulation engine
├── static/                   # Frontend assets, icons, logos, and UI scripts
│   ├── app.js
│   ├── app.css
│   ├── pdf-studio.js
│   └── logo.png
├── extension/                # Chrome Companion Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   └── sidepanel.js
├── UI/                       # UI mocks and reference designs
├── VS_Database.spec          # PyInstaller build specification
├── Run_VS_Database.bat       # Launch script
└── .gitignore
```

---

## Development & Building

### Prerequisites
- Python 3.12+ (64-bit recommended)
- Microsoft Edge WebView2 Runtime
- Dependencies: `pywebview`, `pythonnet`, `pymupdf`, `reportlab`, `pillow`, `pypdf`

### Running Locally
```powershell
python main_app.py
```

### Compiling Executable
```powershell
python -m PyInstaller VS_Database.spec --noconfirm
```
The compiled standalone binary will be generated in `dist/VS_Database.exe`.
