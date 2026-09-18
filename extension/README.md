# VS Database Chrome Extension — Architecture & Reference

This directory contains the Chrome Extension for **VS Database - Office Filing Saver** built on Manifest V3 with the **Chrome Native Side Panel API**.

---

## File Structure

```text
extension/
├── manifest.json       # Manifest V3 configuration with sidePanel & permissions
├── background.js      # Service worker: download interception, proxy & capture
├── sidepanel.html      # Native Side Panel user interface
├── sidepanel.css       # Clean, modern stylesheet for Side Panel
├── sidepanel.js        # Controller: client caching, folder explorer & sync save
├── content.js          # In-page script (intrusive popups disabled; intent tracker)
├── monogram.png        # VS monogram branding
├── icon.png            # Main extension icon
├── icon16.png / 32 / 48 / 128
└── logo.png
```

---

## Key Technical Workflows

### 1. Download Interception (`background.js`)
* Listens to `chrome.downloads.onDeterminingFilename`.
* Captures file bytes into an in-memory buffer (`startBackgroundCapture`).
* Cancels browser download to prevent writing files to `C:\Users\<user>\Downloads`.
* Notifies `sidepanel.js` via runtime messages and opens the Side Panel (`chrome.sidePanel.open`).

### 2. Side Panel Modes (`sidepanel.js`)
* **`⚡ Single Save Mode`**: Each intercepted file becomes the active document to file.
* **`📦 Bulk Filing Mode`**: Multiple downloaded documents accumulate into a batch tray.
* **Locked Extension Rename Tool**: Allows base name renaming while preserving immutable file extensions (`.pdf`, `.xlsx`, `.xls`, `.docx`).

### 3. Server Communication (`VS_API_CALL`)
* All HTTP requests route through `callServerApi()` in `background.js` to bypass webpage CORS and Content Security Policies (CSP).
* Saves are executed synchronously via `PROCESS_SAVE_SYNC`, ensuring files physically exist in `D:\Code Trial\<Client>\<Target_Folder>\...` before reporting success.

---

## Loading into Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension` directory.
4. Click the extension toolbar icon or press `Ctrl+Shift+F` to open the Side Panel.
