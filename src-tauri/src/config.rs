use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    pub config_file: String,
    pub themes_dir: String,
    pub custom_css: String,
    pub vault_config_file: Option<String>,
}

pub fn user_config_dir() -> Result<PathBuf, String> {
    if let Some(data_dir) = portable_data_dir() {
        let dir = data_dir.join("config");
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        return Ok(dir);
    }
    let base =
        dirs::config_dir().ok_or_else(|| "cannot locate the user config directory".to_string())?;
    let dir = base.join("liber");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn portable_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    dir.join("liber-portable.txt")
        .exists()
        .then(|| dir.join("liber-data"))
}

fn vault_config_dir(root: &str) -> Result<PathBuf, String> {
    let dir = Path::new(root).join(".liber");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn config_paths(root: Option<&str>) -> Result<ConfigPaths, String> {
    let dir = user_config_dir()?;
    let themes_dir = dir.join("themes");
    fs::create_dir_all(&themes_dir).map_err(|error| error.to_string())?;

    let vault_config_file = match root {
        Some(root) => Some(
            vault_config_dir(root)?
                .join("config.toml")
                .to_string_lossy()
                .into_owned(),
        ),
        None => None,
    };

    Ok(ConfigPaths {
        config_file: dir.join("config.toml").to_string_lossy().into_owned(),
        themes_dir: themes_dir.to_string_lossy().into_owned(),
        custom_css: dir.join("custom.css").to_string_lossy().into_owned(),
        vault_config_file,
    })
}

fn is_within(candidate: &Path, base: &Path) -> bool {
    candidate == base || candidate.starts_with(base)
}

fn allowed(path: &Path, root: Option<&str>) -> Result<(), String> {
    let config_dir = fs::canonicalize(user_config_dir()?).map_err(|error| error.to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("invalid path: {}", path.display()))?;
    let parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;

    if is_within(&parent, &config_dir) {
        return Ok(());
    }
    if let Some(root) = root {
        let vault_dir =
            fs::canonicalize(vault_config_dir(root)?).map_err(|error| error.to_string())?;
        if is_within(&parent, &vault_dir) {
            return Ok(());
        }
    }
    Err(format!(
        "path is outside the allowed config locations: {}",
        path.display()
    ))
}

pub fn read_text(path: &str, root: Option<&str>) -> Result<Option<String>, String> {
    let path = Path::new(path);
    allowed(path, root)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub fn write_text(path: &str, contents: &str, root: Option<&str>) -> Result<(), String> {
    let path = Path::new(path);
    allowed(path, root)?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn ensure_file(path: &str, starter: &str, root: Option<&str>) -> Result<String, String> {
    match read_text(path, root)? {
        Some(contents) => Ok(contents),
        None => {
            write_text(path, starter, root)?;
            Ok(starter.to_string())
        }
    }
}

pub fn list_files(dir: &str) -> Result<Vec<String>, String> {
    let config_dir = user_config_dir()?;
    let canonical = fs::canonicalize(dir).map_err(|error| error.to_string())?;
    if !is_within(
        &canonical,
        &fs::canonicalize(&config_dir).map_err(|e| e.to_string())?,
    ) {
        return Err(format!("directory is not a config directory: {dir}"));
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&canonical)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "toml") {
            if let Some(name) = path.file_name() {
                files.push(name.to_string_lossy().into_owned());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::is_within;
    use std::path::Path;

    #[test]
    fn is_within_accepts_base_and_children() {
        let base = Path::new("C:/data/liber");
        assert!(is_within(base, base));
        assert!(is_within(Path::new("C:/data/liber/themes"), base));
        assert!(is_within(Path::new("C:/data/liber/themes/a.toml"), base));
    }

    #[test]
    fn is_within_rejects_siblings_and_parents() {
        let base = Path::new("C:/data/liber");
        assert!(!is_within(Path::new("C:/data/other"), base));
        assert!(!is_within(Path::new("C:/data"), base));
        assert!(!is_within(Path::new("C:/data/liber-other/x"), base));
    }
}
