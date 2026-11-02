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
fn get_python_executable() -> String {
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
                return candidate.to_string();
            }
        }
    }

    "pythonw".to_string()
}

/// Ensure Python background sidecar is running and wait for readiness
fn ensure_python_sidecar() -> Result<(), String> {
    if is_python_server_healthy() {
        eprintln!("[Supervisor] Python server already running on port {}", PYTHON_PORT);
        return Ok(());
    }

    let Some(server_script) = locate_server_script() else {
        return Err("Could not locate server.py".to_string());
    };

    let server_dir = server_script
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let python_exe = get_python_executable();
    eprintln!(
        "[Supervisor] Spawning Python sidecar: {} {} in {:?}",
        python_exe,
        server_script.display(),
        server_dir
    );

    let mut cmd = Command::new(&python_exe);
    cmd.arg(&server_script);
    cmd.current_dir(&server_dir);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(_) => {
            eprintln!("[Supervisor] Python process spawned, waiting for health check...");
            let start = Instant::now();
            let timeout = Duration::from_secs(15);
            while start.elapsed() < timeout {
                if is_python_server_healthy() {
                    eprintln!("[Supervisor] Python server is ready and healthy on port {}", PYTHON_PORT);
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err("Timed out waiting for Python server health check on port 8767".to_string())
        }
        Err(e) => Err(format!("Failed to spawn Python process: {}", e)),
    }
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

    // Window close event hook for graceful shutdown
    builder = builder.on_window_event(|_window, event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            eprintln!("[Lifecycle] Window close requested, triggering Python shutdown...");
            send_desktop_shutdown();
        }
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            eprintln!("[Lifecycle] App exit requested, ensuring Python backend shutdown...");
            send_desktop_shutdown();
        }
    });
}
