// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Session state matching the TypeScript schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub id: String,
    pub issue_number: i32,
    pub issue_title: String,
    pub status: String,
    pub branch: String,
    pub worktree_path: String,
    pub started_at: String,
    pub last_heartbeat: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stuck_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forwarded_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_status: Option<WorktreeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub files_changed: i32,
    pub insertions: i32,
    pub deletions: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests_passing: Option<bool>,
}

/// Event sent to frontend when sessions change
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub event_type: String, // "add", "update", "remove"
    pub session: Option<SessionState>,
    pub session_id: Option<String>,
}

/// Get the sessions directory path
fn get_sessions_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".orchestration").join("ppds-orchestration").join("sessions"))
}

/// Load all sessions from the sessions directory
fn load_all_sessions(sessions_dir: &PathBuf) -> Vec<SessionState> {
    let mut sessions = Vec::new();

    if let Ok(entries) = fs::read_dir(sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<SessionState>(&content) {
                        sessions.push(session);
                    }
                }
            }
        }
    }

    sessions
}

/// Tauri command: Get all sessions
#[tauri::command]
fn get_sessions() -> Vec<SessionState> {
    get_sessions_dir()
        .map(|dir| load_all_sessions(&dir))
        .unwrap_or_default()
}

/// Tauri command: Forward a message to a worker
#[tauri::command]
async fn forward_message(session_id: String, message: String) -> Result<(), String> {
    let output = std::process::Command::new("orch")
        .args(["forward", &session_id, &message])
        .output()
        .map_err(|e| format!("Failed to run orch forward: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Tauri command: Cancel a session
#[tauri::command]
async fn cancel_session(session_id: String) -> Result<(), String> {
    let output = std::process::Command::new("orch")
        .args(["cancel", &session_id])
        .output()
        .map_err(|e| format!("Failed to run orch cancel: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Start watching the sessions directory for changes
fn start_session_watcher(app_handle: AppHandle) {
    std::thread::spawn(move || {
        let sessions_dir = match get_sessions_dir() {
            Some(dir) => dir,
            None => {
                eprintln!("Could not determine sessions directory");
                return;
            }
        };

        // Create directory if it doesn't exist
        let _ = fs::create_dir_all(&sessions_dir);

        let (tx, rx) = channel();

        let config = Config::default().with_poll_interval(Duration::from_secs(1));
        let mut watcher: RecommendedWatcher = match Watcher::new(tx, config) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&sessions_dir, RecursiveMode::NonRecursive) {
            eprintln!("Failed to watch directory: {}", e);
            return;
        }

        println!("Watching sessions directory: {:?}", sessions_dir);

        for result in rx {
            match result {
                Ok(event) => {
                    // Process file changes
                    for path in event.paths {
                        if path.extension().map_or(false, |ext| ext == "json") {
                            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                            // Determine event type based on file existence
                            if path.exists() {
                                // File was created or modified
                                if let Ok(content) = fs::read_to_string(&path) {
                                    if let Ok(session) = serde_json::from_str::<SessionState>(&content) {
                                        let event = SessionEvent {
                                            event_type: "update".to_string(),
                                            session: Some(session),
                                            session_id: None,
                                        };
                                        let _ = app_handle.emit("session-event", event);
                                    }
                                }
                            } else {
                                // File was deleted
                                let session_id = file_name.trim_end_matches(".json").to_string();
                                let event = SessionEvent {
                                    event_type: "remove".to_string(),
                                    session: None,
                                    session_id: Some(session_id),
                                };
                                let _ = app_handle.emit("session-event", event);
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Watch error: {}", e);
                }
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            forward_message,
            cancel_session
        ])
        .setup(|app| {
            // Start watching sessions directory
            start_session_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
