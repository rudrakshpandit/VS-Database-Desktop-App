# VS Database Chrome Extension — Architecture & Reference

This directory contains the companion Chrome Extension for **VS Database Desktop Application (Port 8767)** built on Chrome Manifest V3 with the **Native Side Panel API** and **High-Performance Streaming Bulk Collector**.

---

## File Structure

```text
extension/
├── manifest.json       # Manifest V3 configuration with sidePanel & permissions (v2.1.0)
├── background.js      # Service worker: download interception, zero-copy staging & proxy
├── sidepanel.html      # Native Side Panel user interface
├── sidepanel.css       # Clean, modern stylesheet for Side Panel
├── sidepanel.js        # Controller: client caching, folder explorer & sync save
├── content.js          # In-page script: Bulk Collector dock, KB progress modal & intent tracker
├── monogram.png        # VS monogram branding
├── icon.png            # Main extension icon
├── icon16.png / 32 / 48 / 128
└── logo.png
```

---

## Key Technical Workflows & Performance Optimizations

### 1. Zero-Copy Disk Staging (`background.js`)
* Listens to `chrome.downloads.onDeterminingFilename`.
* Checks for completed local files via `waitForDownloadComplete()`.
* **Zero-Copy Ingestion**: Passes `source_local_path` directly to the desktop app (`staging_mgr.add_file_from_disk`), transferring in **< 1ms** without transferring heavy Base64 strings across JSON.
* Base64 is used strictly as a fallback for in-memory `blob:` and `data:` URLs.

### 2. Dual-Buffer Pipelining & Real-Time Glass Progress Bar (`content.js`)
* **Sequential Staging (`STAGE_SINGLE_FILE`)**: Transmits queued documents one by one to prevent browser thread freezes and server memory spikes.
* **Dual-Buffer Pre-fetching**: While document $N$ is being posted over loopback, document $N+1$ is concurrently pre-fetched in memory.
* **KB-Accurate Progress Modal**: Displays real-time transferred KB / total KB and percentage based on bytes transferred:
  $$\text{Percent} = \frac{\text{transferredBytes}}{\text{totalBytes}} \times 100$$
* Styled with glassmorphism matching the desktop app (`.vs-progress-card`, backdrop blur, and animated gradients).

### 3. Sticky Loopback Discovery & On-Demand Focus Return (`background.js`)
* **0ms Sticky Cache**: Caches port 8767 in memory with 35ms loopback probes.
* **On-Demand Return Poller**: Instead of a permanent polling loop, `startReturnCheck()` activates only when documents are actively handed to the desktop app and stops immediately once focus is returned.

---

## Loading into Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension` directory (or click **Reload** if already loaded).
4. Click the extension toolbar icon or press `Ctrl+Shift+F` to open the Side Panel.
