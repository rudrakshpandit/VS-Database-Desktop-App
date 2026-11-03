use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PYTHON_PORT: u16 = 8767;

/// Check if the local Python server is healthy and responding on port 8767
pub fn is_python_server_healthy() -> bool {
    let addr_str = format!("127.0.0.1:{}", PYTHON_PORT);
    let Ok(addr) = addr_str.parse::<SocketAddr>() else {
        return false;
    };

    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(600)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));

    let request = format!(
        "GET /api/desktop/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        PYTHON_PORT
    );

    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 1024];
    if let Ok(n) = stream.read(&mut buf) {
        if n > 0 {
            let response = String::from_utf8_lossy(&buf[..n]);
            return response.contains("200 OK")
                || response.contains("HTTP/1.1 200")
                || response.contains("HTTP/1.0 200");
        }
    }

    false
}

/// Send graceful shutdown signal to the local Python backend
pub fn send_desktop_shutdown() {
    let addr_str = format!("127.0.0.1:{}", PYTHON_PORT);
    let Ok(addr) = addr_str.parse::<SocketAddr>() else {
        return;
    };

    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(1000)) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
        let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));

        let body = r#"{"force": true}"#;
        let request = format!(
            "POST /api/desktop/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            PYTHON_PORT,
            body.len(),
            body
        );

        let _ = stream.write_all(request.as_bytes());
        let mut buf = [0u8; 256];
        let _ = stream.read(&mut buf);
    }
}

/// Send UI detach signal so backend knows desktop window closed while keeping server alive for LAN clients (DEF-003)
pub fn send_desktop_detach() {
    let addr_str = format!("127.0.0.1:{}", PYTHON_PORT);
    let Ok(addr) = addr_str.parse::<SocketAddr>() else {
        return;
    };

    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(1000)) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
        let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));

        let body = r#"{"instance_id": "tauri-main-ui"}"#;
        let request = format!(
            "POST /api/desktop/ui-detach HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            PYTHON_PORT,
            body.len(),
            body
        );

        let _ = stream.write_all(request.as_bytes());
    }
}

/// Check lifecycle policy: whether backend can be terminated or must stay alive for LAN/companion
pub fn can_shutdown_backend() -> bool {
    let addr_str = format!("127.0.0.1:{}", PYTHON_PORT);
    let Ok(addr) = addr_str.parse::<SocketAddr>() else {
        return true;
    };

    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(600)) else {
        return true;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1000)));

    let request = format!(
        "GET /api/desktop/lifecycle-policy HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        PYTHON_PORT
    );

    if stream.write_all(request.as_bytes()).is_err() {
        return true;
    }

    let mut buf = [0u8; 1024];
    if let Ok(n) = stream.read(&mut buf) {
        let response = String::from_utf8_lossy(&buf[..n]);
        if response.contains("\"can_terminate\": false") || response.contains("\"can_terminate\":false") {
            return false;
        }
    }

    true
}

/// Locate standalone packaged sidecar executable across release, binaries, and migration directories (DEF-002)
fn locate_sidecar_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("server_sidecar.exe"));
            candidates.push(parent.join("server_sidecar-x86_64-pc-windows-gnu.exe"));
            candidates.push(parent.join("binaries").join("server_sidecar-x86_64-pc-windows-gnu.exe"));
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.join("server_sidecar.exe"));
                candidates.push(grandparent.join("dist").join("server_sidecar.exe"));
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("server_sidecar.exe"));
        candidates.push(cwd.join("dist").join("server_sidecar.exe"));
        candidates.push(cwd.join("binaries").join("server_sidecar-x86_64-pc-windows-gnu.exe"));
        candidates.push(cwd.join("src-tauri").join("binaries").join("server_sidecar-x86_64-pc-windows-gnu.exe"));
    }

    candidates.push(PathBuf::from(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\server_sidecar.exe"));
    candidates.push(PathBuf::from(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\dist\server_sidecar.exe"));
    candidates.push(PathBuf::from(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\src-tauri\binaries\server_sidecar-x86_64-pc-windows-gnu.exe"));

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// Locate the server.py script file across common development and release paths
fn locate_server_script() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("server.py"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("server.py"));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("server.py"));
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.join("server.py"));
                if let Some(great) = grandparent.parent() {
                    candidates.push(great.join("server.py"));
                }
            }
        }
    }

    // Direct migration folder fallback
    candidates.push(PathBuf::from(r"D:\AntiGravity Automation\VS Database 2.0 - Tauri Migration\server.py"));

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// Determine the best available Python executable
fn get_python_executable() -> Option<String> {
    let candidates = [
        "pythonw",
        "python",
        r"C:\Python314\pythonw.exe",
        r"C:\Python314\python.exe",
    ];

    for candidate in candidates {
        let mut cmd = Command::new(candidate);
        cmd.arg("--version");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

/// Ensure Python background sidecar is running and wait for readiness
fn ensure_python_sidecar() -> Result<(), String> {
    if is_python_server_healthy() {
        eprintln!("[Supervisor] Backend server already running on port {}", PYTHON_PORT);
        return Ok(());
    }

    // 1. Try launching standalone packaged sidecar first (DEF-002: no system Python required)
    if let Some(sidecar_bin) = locate_sidecar_binary() {
        let sidecar_dir = sidecar_bin
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        eprintln!("[Supervisor] Launching standalone sidecar: {:?} in {:?}", sidecar_bin, sidecar_dir);
        let mut cmd = Command::new(&sidecar_bin);
        cmd.current_dir(&sidecar_dir);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(_child) = cmd.spawn() {
            eprintln!("[Supervisor] Standalone sidecar spawned, waiting for health check...");
            let start = Instant::now();
            let timeout = Duration::from_secs(20);
            while start.elapsed() < timeout {
                if is_python_server_healthy() {
                    eprintln!("[Supervisor] Standalone sidecar is healthy on port {}", PYTHON_PORT);
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }

    // 2. Fallback to developer script with system Python
    if let Some(server_script) = locate_server_script() {
        let server_dir = server_script
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        if let Some(python_exe) = get_python_executable() {
            eprintln!(
                "[Supervisor] Spawning Python development script: {} {} in {:?}",
                python_exe,
                server_script.display(),
                server_dir
            );

            let mut cmd = Command::new(&python_exe);
            cmd.arg(&server_script);
            cmd.current_dir(&server_dir);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);

            if let Ok(_child) = cmd.spawn() {
                eprintln!("[Supervisor] Python script spawned, waiting for health check...");
                let start = Instant::now();
                let timeout = Duration::from_secs(15);
                while start.elapsed() < timeout {
                    if is_python_server_healthy() {
                        eprintln!("[Supervisor] Python server is ready and healthy on port {}", PYTHON_PORT);
                        return Ok(());
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            }
        }
    }

    Err("Could not start Python backend via either standalone sidecar or system Python".to_string())
}

// Window control commands
#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_python_health() -> bool {
    is_python_server_healthy()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance plugin
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    // Opener & Dialog plugins
    builder = builder.plugin(tauri_plugin_opener::init());
    builder = builder.plugin(tauri_plugin_dialog::init());

    // Window controls and health commands
    builder = builder.invoke_handler(tauri::generate_handler![
        minimize_window,
        maximize_window,
        close_window,
        get_python_health
    ]);

    // Setup lifecycle: supervisor spawn & health check
    builder = builder.setup(|_app| {
        std::thread::spawn(|| {
            if let Err(e) = ensure_python_sidecar() {
                eprintln!("[Supervisor Error] {}", e);
            }
        });
        Ok(())
    });

    // Window close event hook for lifecycle decoupling (DEF-003)
    builder = builder.on_window_event(|_window, event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            if can_shutdown_backend() {
                eprintln!("[Lifecycle] No active LAN clients or LAN mode. Shutting down backend...");
                send_desktop_shutdown();
            } else {
                eprintln!("[Lifecycle] Active LAN clients or LAN mode enabled. Detaching UI while preserving server...");
                send_desktop_detach();
            }
        }
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if can_shutdown_backend() {
                eprintln!("[Lifecycle] App exit requested, ensuring backend shutdown...");
                send_desktop_shutdown();
            } else {
                eprintln!("[Lifecycle] App exit with LAN mode, server retained.");
                send_desktop_detach();
            }
        }
    });
}
