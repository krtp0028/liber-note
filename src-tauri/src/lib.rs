pub mod config;
pub mod doctor;
pub mod fs;
pub mod lua;
pub mod vault;

use notify::Watcher;
use std::sync::Mutex;
use tauri::Emitter;

struct WatcherState(Mutex<Option<notify::RecommendedWatcher>>);
struct LuaState(Mutex<Option<lua::LuaHost>>);

#[tauri::command]
fn vault_scan(root: String) -> Result<Vec<vault::FileMeta>, String> {
    vault::scan_vault(&root)
}

#[tauri::command]
fn vault_read_file(root: String, rel_path: String) -> Result<String, String> {
    vault::read_file(&root, &rel_path)
}

#[tauri::command]
fn vault_write_file(root: String, rel_path: String, contents: String) -> Result<(), String> {
    vault::write_file(&root, &rel_path, &contents)
}

#[tauri::command]
fn vault_write_binary(root: String, rel_path: String, data: String) -> Result<(), String> {
    vault::write_binary(&root, &rel_path, &data)
}

#[tauri::command]
fn vault_import_external(root: String, source: String, rel_path: String) -> Result<(), String> {
    vault::import_external(&root, &source, &rel_path)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let directory = std::path::Path::new(&path)
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from(&path));
        std::process::Command::new("xdg-open")
            .arg(directory)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn vault_search(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<vault::SearchHit>, String> {
    vault::search_vault(&root, &query, limit)
}

#[tauri::command]
fn vault_create_dir(root: String, rel_path: String) -> Result<(), String> {
    vault::create_dir(&root, &rel_path)
}

#[tauri::command]
fn vault_rename(root: String, from: String, to: String) -> Result<(), String> {
    vault::rename_path(&root, &from, &to)
}

#[tauri::command]
fn vault_duplicate(root: String, from: String, to: String) -> Result<(), String> {
    vault::duplicate_path(&root, &from, &to)
}

#[tauri::command]
fn vault_trash(root: String, rel_path: String) -> Result<String, String> {
    vault::trash_move(&root, &rel_path)
}

#[tauri::command]
fn vault_restore(root: String, trash_id: String) -> Result<String, String> {
    vault::trash_restore(&root, &trash_id)
}

#[tauri::command]
fn trash_list(root: String) -> Result<Vec<vault::TrashEntry>, String> {
    vault::trash_list(&root)
}

#[tauri::command]
fn trash_delete(root: String, trash_id: String) -> Result<(), String> {
    vault::trash_delete(&root, &trash_id)
}

#[tauri::command]
fn trash_empty(root: String) -> Result<u32, String> {
    vault::trash_empty(&root)
}

#[tauri::command]
fn write_text_absolute(path: String, contents: String) -> Result<(), String> {
    vault::write_absolute(&path, &contents)
}

#[tauri::command]
fn watch_vault(
    app: tauri::AppHandle,
    state: tauri::State<WatcherState>,
    root: String,
) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(
            std::path::Path::new(&root),
            notify::RecursiveMode::Recursive,
        )
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            std::thread::sleep(std::time::Duration::from_millis(250));
            while receiver.try_recv().is_ok() {}
            let _ = app_handle.emit("vault-changed", ());
        }
    });

    *state.inner().0.lock().map_err(|error| error.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
fn doctor_audit(root: String) -> Result<Vec<doctor::Issue>, String> {
    doctor::audit(&root)
}

#[tauri::command]
fn doctor_plan(
    root: String,
    fix: String,
    payload: serde_json::Value,
) -> Result<doctor::Plan, String> {
    doctor::plan(&root, &fix, &payload)
}

#[tauri::command]
fn doctor_apply(root: String, fix: String, payload: serde_json::Value) -> Result<usize, String> {
    doctor::apply(&root, &fix, &payload)
}

#[tauri::command]
fn config_paths(root: Option<String>) -> Result<config::ConfigPaths, String> {
    config::config_paths(root.as_deref())
}

#[tauri::command]
fn config_read(path: String, root: Option<String>) -> Result<Option<String>, String> {
    config::read_text(&path, root.as_deref())
}

#[tauri::command]
fn config_write(path: String, contents: String, root: Option<String>) -> Result<(), String> {
    config::write_text(&path, &contents, root.as_deref())
}

#[tauri::command]
fn config_ensure(path: String, starter: String, root: Option<String>) -> Result<String, String> {
    config::ensure_file(&path, &starter, root.as_deref())
}

#[tauri::command]
fn themes_list(dir: String) -> Result<Vec<String>, String> {
    config::list_files(&dir)
}

#[tauri::command]
fn open_external(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn lua_reload(state: tauri::State<LuaState>, dir: String) -> Result<(), String> {
    let host = lua::build(&dir)?;
    *state.inner().0.lock().map_err(|error| error.to_string())? = Some(host);
    Ok(())
}

#[tauri::command]
fn lua_commands(state: tauri::State<LuaState>) -> Result<Vec<lua::LuaCommandMeta>, String> {
    let guard = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(guard
        .as_ref()
        .map(|host| host.commands().to_vec())
        .unwrap_or_default())
}

#[tauri::command]
fn lua_keymaps(state: tauri::State<LuaState>) -> Result<Vec<lua::LuaKeymap>, String> {
    let guard = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(guard
        .as_ref()
        .map(|host| host.keymaps().to_vec())
        .unwrap_or_default())
}

#[tauri::command]
fn lua_run(state: tauri::State<LuaState>, name: String) -> Result<Option<String>, String> {
    let mut guard = state.inner().0.lock().map_err(|error| error.to_string())?;
    match guard.as_mut() {
        Some(host) => host.run_command(&name),
        None => Err("lua is not initialized".to_string()),
    }
}

#[tauri::command]
fn lua_hook(
    state: tauri::State<LuaState>,
    event: String,
    payload: String,
) -> Result<Option<String>, String> {
    let mut guard = state.inner().0.lock().map_err(|error| error.to_string())?;
    match guard.as_mut() {
        Some(host) => host.run_hook(&event, &payload),
        None => Ok(None),
    }
}

#[tauri::command]
fn lua_drain_messages(state: tauri::State<LuaState>) -> Result<Vec<String>, String> {
    let mut guard = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(match guard.as_mut() {
        Some(host) => host.drain_messages(),
        None => Vec::new(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .manage(LuaState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            vault_scan,
            vault_read_file,
            vault_write_file,
            vault_write_binary,
            vault_import_external,
            reveal_path,
            vault_search,
            vault_create_dir,
            vault_rename,
            vault_duplicate,
            vault_trash,
            vault_restore,
            trash_list,
            trash_delete,
            trash_empty,
            write_text_absolute,
            watch_vault,
            doctor_audit,
            doctor_plan,
            doctor_apply,
            config_paths,
            config_read,
            config_write,
            config_ensure,
            themes_list,
            open_external,
            lua_reload,
            lua_commands,
            lua_keymaps,
            lua_run,
            lua_hook,
            lua_drain_messages
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
