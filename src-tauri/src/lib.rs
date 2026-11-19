use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct SidecarState(Mutex<Option<Child>>);

fn spawn_next_sidecar(app: &AppHandle) -> Result<(), String> {
  let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
  let script = resource_dir.join("scripts/windows/start-lumen-sidecar.ps1");
  if !script.exists() {
    return Ok(());
  }
  let child = Command::new("powershell")
    .args([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script.to_string_lossy().as_ref(),
    ])
    .env("LUMEN_RESOURCE_DIR", resource_dir.as_os_str())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("No pude arrancar el sidecar: {e}"))?;
  let state = app.state::<SidecarState>();
  *state.0.lock().map_err(|e| e.to_string())? = Some(child);
  Ok(())
}

async fn ollama_ready() -> bool {
  reqwest::Client::new()
    .get("http://127.0.0.1:11434/api/tags")
    .send()
    .await
    .map(|r| r.status().is_success())
    .unwrap_or(false)
}

#[tauri::command]
async fn check_ollama() -> Result<bool, String> {
  Ok(ollama_ready().await)
}

#[tauri::command]
async fn pull_ollama_model(model: String) -> Result<String, String> {
  let status = Command::new("ollama")
    .args(["pull", &model])
    .status()
    .map_err(|e| format!("No encontré Ollama en el PATH: {e}"))?;
  if status.success() {
    Ok(format!("Modelo {model} listo"))
  } else {
    Err(format!("Falló ollama pull {model}"))
  }
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      let _ = show_main_window(app.clone());
    }))
    .plugin(tauri_plugin_autostart::init(
      MacosLauncher::LaunchAgent,
      Some(vec!["--autostart"]),
    ))
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .manage(SidecarState(Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![
      check_ollama,
      pull_ollama_model,
      show_main_window
    ])
    .setup(|app| {
      let _ = spawn_next_sidecar(app.handle());

      let show_i = MenuItem::with_id(app, "show", "Mostrar Lumen", true, None::<&str>)?;
      let quit_i = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Lumen")
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => {
            let _ = show_main_window(app.clone());
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let _ = show_main_window(tray.app_handle().clone());
          }
        })
        .build(app)?;

      let ctrl_space = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
      let handle = app.handle().clone();
      app.global_shortcut().on_shortcut(ctrl_space, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
          let _ = show_main_window(handle.clone());
        }
      })?;

      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .build(tauri::generate_context!())
    .expect("error al iniciar Lumen")
    .run(|app_handle, event| {
      if let RunEvent::Exit = event {
        if let Ok(mut guard) = app_handle.state::<SidecarState>().0.lock() {
          if let Some(child) = guard.as_mut() {
            let _ = child.kill();
          }
        }
      }
    });
}
