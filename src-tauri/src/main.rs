#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{process::{Child, Command}, sync::Mutex};
use tauri::{AppHandle, Manager, PhysicalPosition};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct HubServer(Mutex<Option<Child>>);

#[tauri::command]
fn set_dock_position(app: AppHandle, side: String) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No se encontró la ventana principal")?;
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?.ok_or("No se encontró el monitor principal")?;
    let screen = monitor.size();
    let origin = monitor.position();
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let x = if side == "left" { origin.x } else { origin.x + screen.width as i32 - size.width as i32 };
    let y = origin.y + ((screen.height as i32 - size.height as i32) / 2).max(0);
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_dock_position])
        .setup(|app| {
            let window = app.get_webview_window("main").ok_or_else(|| std::io::Error::other("No se encontró la ventana principal"))?;
            let monitor = window.primary_monitor()?.ok_or_else(|| std::io::Error::other("No se encontró el monitor principal"))?;
            let screen = monitor.size();
            let origin = monitor.position();
            let size = window.outer_size()?;
            let x = origin.x + screen.width as i32 - size.width as i32;
            let y = origin.y + ((screen.height as i32 - size.height as i32) / 2).max(0);
            window.set_position(PhysicalPosition::new(x, y))?;
            // In development, `beforeDevCommand` starts the Node server. In a bundle,
            // the UI and the local event service are shipped as resources.
            if !cfg!(debug_assertions) {
                let resource = app.path().resource_dir()?;
                let server = resource.join("server").join("index.js");
                let mut command = Command::new("node");
                command.arg(server);
                #[cfg(windows)]
                command.creation_flags(0x08000000);
                let child = command.spawn()?;
                app.manage(HubServer(Mutex::new(Some(child))));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar Agente Hub");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(server) = app.try_state::<HubServer>() {
                if let Ok(mut child) = server.0.lock() {
                    if let Some(child) = child.as_mut() { let _ = child.kill(); }
                }
            }
        }
    });
}
