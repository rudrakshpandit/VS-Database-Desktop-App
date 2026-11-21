// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-gpu-rasterization --enable-zero-copy --disable-features=CalculateNativeWinOcclusion"
        );
    }
    app_lib::run();
}
