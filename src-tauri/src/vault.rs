use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    ".liber",
    ".hg",
    ".svn",
    ".obsidian",
    ".trash",
    "node_modules",
];

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const METRICS_READ_CAP: u64 = 512 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frontmatter {
    pub parent: Option<String>,
    pub also_under: Vec<String>,
    pub order: Option<f64>,
    pub tags: Vec<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub numbers: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetrics {
    pub tasks_open: u32,
    pub tasks_done: u32,
    pub words: u32,
    pub links: Vec<String>,
    pub tasks: Vec<TaskItem>,
    pub images: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub size: u64,
    pub modified_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub rel_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: i64,
    pub frontmatter: Frontmatter,
    pub metrics: FileMetrics,
}

pub fn scan_vault(root: &str) -> Result<Vec<FileMeta>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("vault path is not a directory: {root}"));
    }

    let mut entries = Vec::new();
    walk(root_path, root_path, &mut entries);
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(entries)
}

pub fn read_file(root: &str, rel_path: &str) -> Result<String, String> {
    let path = resolve(root, rel_path)?;
    let metadata =
        fs::metadata(&path).map_err(|error| format!("failed to read {rel_path}: {error}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!("file is too large to open: {rel_path}"));
    }
    fs::read_to_string(&path).map_err(|error| format!("failed to read {rel_path}: {error}"))
}

pub fn write_file(root: &str, rel_path: &str, contents: &str) -> Result<(), String> {
    write_bytes(root, rel_path, contents.as_bytes())
}

pub fn write_bytes(root: &str, rel_path: &str, contents: &[u8]) -> Result<(), String> {
    let path = resolve(root, rel_path)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("invalid path: {rel_path}"))?;
    fs::create_dir_all(parent).map_err(|error| format!("failed to create {rel_path}: {error}"))?;

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| format!("invalid path: {rel_path}"))?;
    let temp_path = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, &path)
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to write {rel_path}: {error}"));
    }

    Ok(())
}

pub fn write_binary(root: &str, rel_path: &str, base64_data: &str) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|error| format!("invalid base64 data: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("file is too large to write: {rel_path}"));
    }
    write_bytes(root, rel_path, &bytes)
}

pub fn import_external(root: &str, source: &str, rel_path: &str) -> Result<(), String> {
    let path = Path::new(source);
    if !path.is_file() {
        return Err(format!("source file does not exist: {source}"));
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!("file is too large to import: {source}"));
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    write_bytes(root, rel_path, &bytes)
}

fn resolve(root: &str, rel_path: &str) -> Result<PathBuf, String> {
    let normalized = crate::fs::normalize_rel_path(rel_path)?;
    if normalized.is_empty() {
        return Err("path must not be empty".to_string());
    }
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("vault path is not a directory: {root}"));
    }
    Ok(root_path.join(normalized))
}

pub fn rename_path(root: &str, from: &str, to: &str) -> Result<(), String> {
    let source = resolve(root, from)?;
    let destination = resolve(root, to)?;
    if !source.exists() {
        return Err(format!("path does not exist: {from}"));
    }
    if destination.exists() {
        return Err(format!("destination already exists: {to}"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&source, &destination).map_err(|error| error.to_string())
}

pub fn duplicate_path(root: &str, from: &str, to: &str) -> Result<(), String> {
    let source = resolve(root, from)?;
    let destination = resolve(root, to)?;
    if !source.is_file() {
        return Err(format!("only files can be duplicated: {from}"));
    }
    if destination.exists() {
        return Err(format!("destination already exists: {to}"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn create_dir(root: &str, rel_path: &str) -> Result<(), String> {
    let path = resolve(root, rel_path)?;
    if path.exists() {
        return Err(format!("path already exists: {rel_path}"));
    }
    fs::create_dir_all(&path).map_err(|error| error.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub rel_path: String,
    pub line: u32,
    pub text: String,
}

const SEARCH_LIMIT_PER_FILE: usize = 3;
const SEARCH_TEXT_MAX: usize = 200;

pub fn search_vault(root: &str, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let root_path = Path::new(root);
    let entries = scan_vault(root)?;
    let mut hits: Vec<SearchHit> = Vec::new();

    for entry in entries {
        if entry.is_dir || hits.len() >= limit {
            continue;
        }
        let path = root_path.join(&entry.rel_path);
        let Some(head) = read_head(&path) else {
            continue;
        };
        let mut per_file = 0;
        for (index, line) in head.lines().enumerate() {
            if per_file >= SEARCH_LIMIT_PER_FILE || hits.len() >= limit {
                break;
            }
            if line.to_lowercase().contains(&needle) {
                let text: String = line.trim().chars().take(SEARCH_TEXT_MAX).collect();
                hits.push(SearchHit {
                    rel_path: entry.rel_path.clone(),
                    line: (index + 1) as u32,
                    text,
                });
                per_file += 1;
            }
        }
    }

    Ok(hits)
}

pub fn trash_move(root: &str, rel_path: &str) -> Result<String, String> {
    let source = resolve(root, rel_path)?;
    if !source.exists() {
        return Err(format!("path does not exist: {rel_path}"));
    }
    let trash_dir = Path::new(root).join(".liber").join("trash");
    fs::create_dir_all(&trash_dir).map_err(|error| error.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let trash_id = format!("{stamp}__{}", rel_path.replace('/', "__"));
    fs::rename(&source, trash_dir.join(&trash_id)).map_err(|error| error.to_string())?;
    Ok(trash_id)
}

pub fn trash_restore(root: &str, trash_id: &str) -> Result<String, String> {
    if trash_id.contains('/') || trash_id.contains('\\') || trash_id.contains("..") {
        return Err(format!("invalid trash id: {trash_id}"));
    }
    let trash_path = Path::new(root).join(".liber").join("trash").join(trash_id);
    if !trash_path.exists() {
        return Err(format!("trash entry not found: {trash_id}"));
    }
    let Some((_, mangled)) = trash_id.split_once("__") else {
        return Err(format!("invalid trash id: {trash_id}"));
    };
    let original = mangled.replace("__", "/");
    let destination = resolve(root, &original)?;
    if destination.exists() {
        return Err(format!("destination already exists: {original}"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&trash_path, &destination).map_err(|error| error.to_string())?;
    Ok(original)
}

pub fn trash_list(root: &str) -> Result<Vec<TrashEntry>, String> {
    let trash_dir = Path::new(root).join(".liber").join("trash");
    if !trash_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&trash_dir)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        entries.push(TrashEntry {
            id: entry.file_name().to_string_lossy().into_owned(),
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            modified_ms,
        });
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.modified_ms));
    Ok(entries)
}

pub fn trash_delete(root: &str, trash_id: &str) -> Result<(), String> {
    if trash_id.contains('/') || trash_id.contains('\\') || trash_id.contains("..") {
        return Err(format!("invalid trash id: {trash_id}"));
    }
    let path = Path::new(root).join(".liber").join("trash").join(trash_id);
    if !path.exists() {
        return Err(format!("trash entry not found: {trash_id}"));
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(&path).map_err(|error| error.to_string())
    }
}

pub fn trash_empty(root: &str) -> Result<u32, String> {
    let entries = trash_list(root)?;
    let count = entries.len() as u32;
    for entry in entries {
        trash_delete(root, &entry.id)?;
    }
    Ok(count)
}

pub fn write_absolute(path: &str, contents: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn walk(root: &Path, dir: &Path, entries: &mut Vec<FileMeta>) {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(_) => return,
    };

    for child in read.flatten() {
        let file_type = match child.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }

        let path = child.path();
        let name = child.file_name();
        let name = name.to_string_lossy();

        if file_type.is_dir() {
            if EXCLUDED_DIRS.contains(&name.as_ref()) {
                continue;
            }
            if let Some(meta) = entry_meta(root, &path, true) {
                entries.push(meta);
            }
            walk(root, &path, entries);
        } else if file_type.is_file() {
            if let Some(meta) = entry_meta(root, &path, false) {
                entries.push(meta);
            }
        }
    }
}

fn entry_meta(root: &Path, path: &Path, is_dir: bool) -> Option<FileMeta> {
    let rel = path.strip_prefix(root).ok()?;
    let rel_path = rel
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");

    let metadata = fs::metadata(path).ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);

    let (frontmatter, metrics) = if is_dir {
        (Frontmatter::default(), FileMetrics::default())
    } else {
        match read_head(path) {
            Some(head) => (
                parse_frontmatter(&head).unwrap_or_default(),
                count_metrics(&head),
            ),
            None => (Frontmatter::default(), FileMetrics::default()),
        }
    };

    Some(FileMeta {
        rel_path,
        is_dir,
        size: if is_dir { 0 } else { metadata.len() },
        modified_ms,
        frontmatter,
        metrics,
    })
}

fn read_head(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    if extension != "md" && extension != "markdown" && extension != "txt" {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::new();
    file.take(METRICS_READ_CAP).read_to_end(&mut buffer).ok()?;
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

fn strip_quotes(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'')
        {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn parse_list(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(trimmed);
    inner
        .split(',')
        .map(strip_quotes)
        .filter(|item| !item.is_empty())
        .collect()
}

fn apply_scalar(frontmatter: &mut Frontmatter, key: &str, value: &str) {
    match key {
        "parent" => {
            let cleaned = strip_quotes(value);
            if !cleaned.is_empty() {
                frontmatter.parent = Some(cleaned);
            }
        }
        "also_under" | "also-under" => {
            frontmatter.also_under = parse_list(value);
        }
        "tags" => {
            frontmatter.tags = parse_list(value);
        }
        "order" => {
            if let Ok(parsed) = strip_quotes(value).parse::<f64>() {
                frontmatter.order = Some(parsed);
            }
        }
        "color" => {
            let cleaned = strip_quotes(value);
            if !cleaned.is_empty() {
                frontmatter.color = Some(cleaned);
            }
        }
        "icon" => {
            let cleaned = strip_quotes(value);
            if !cleaned.is_empty() {
                frontmatter.icon = Some(cleaned);
            }
        }
        _ => {}
    }
    if let Ok(parsed) = strip_quotes(value).parse::<f64>() {
        frontmatter.numbers.insert(key.to_string(), parsed);
    }
}

fn apply_list(frontmatter: &mut Frontmatter, key: &str, values: &[String]) {
    match key {
        "also_under" | "also-under" => frontmatter.also_under = values.to_vec(),
        "tags" => frontmatter.tags = values.to_vec(),
        _ => {}
    }
}

pub fn parse_frontmatter(head: &str) -> Option<Frontmatter> {
    let mut lines = head.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }

    let mut frontmatter = Frontmatter::default();
    let mut active_key: Option<String> = None;
    let mut list_values: Vec<String> = Vec::new();

    for line in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" {
            break;
        }
        if trimmed.trim_start().starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.trim_start().strip_prefix("- ") {
            if active_key.is_some() {
                list_values.push(strip_quotes(item));
            }
            continue;
        }
        let Some(colon) = trimmed.find(':') else {
            continue;
        };
        if let Some(key) = active_key.take() {
            if !list_values.is_empty() {
                apply_list(&mut frontmatter, &key, &list_values.clone());
            }
            list_values.clear();
        }
        let key = trimmed[..colon].trim().to_string();
        let value = trimmed[colon + 1..].trim();
        if value.is_empty() {
            active_key = Some(key);
        } else {
            apply_scalar(&mut frontmatter, &key, value);
        }
    }

    if let Some(key) = active_key.take() {
        if !list_values.is_empty() {
            apply_list(&mut frontmatter, &key, &list_values);
        }
    }

    Some(frontmatter)
}

pub fn count_metrics(head: &str) -> FileMetrics {
    let mut metrics = FileMetrics {
        words: head.split_whitespace().count() as u32,
        ..FileMetrics::default()
    };

    for (index, line) in head.lines().enumerate() {
        let trimmed = line.trim_start();
        let Some(rest) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "))
        else {
            continue;
        };
        if rest.starts_with("[ ]") {
            metrics.tasks_open += 1;
            if metrics.tasks.len() < 200 {
                let text: String = rest
                    .trim_start_matches("[ ]")
                    .trim()
                    .chars()
                    .take(200)
                    .collect();
                metrics.tasks.push(TaskItem {
                    line: (index + 1) as u32,
                    text,
                });
            }
        } else if rest.starts_with("[x]") || rest.starts_with("[X]") {
            metrics.tasks_done += 1;
        }
    }

    let mut remaining = head;
    while let Some(start) = remaining.find("[[") {
        let after = &remaining[start + 2..];
        let Some(end) = after.find("]]") else {
            break;
        };
        let target = after[..end].split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            metrics.links.push(target.to_string());
        }
        remaining = &after[end + 2..];
    }

    let mut remaining = head;
    while let Some(start) = remaining.find("![") {
        let after = &remaining[start + 2..];
        let Some(label_end) = after.find("](") else {
            remaining = &remaining[start + 2..];
            continue;
        };
        let after_url = &after[label_end + 2..];
        let Some(url_end) = after_url.find(')') else {
            break;
        };
        let url = after_url[..url_end].trim();
        if !url.is_empty() && !url.starts_with("http") {
            metrics.images.push(url.to_string());
        }
        remaining = &after_url[url_end + 1..];
    }

    metrics
}

#[cfg(test)]
mod tests {
    use super::{read_file, scan_vault, write_file, FileMeta};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_vault() -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("liber-scan-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn rel_paths(entries: &[FileMeta]) -> Vec<&str> {
        entries
            .iter()
            .map(|entry| entry.rel_path.as_str())
            .collect()
    }

    #[test]
    fn scans_nested_entries_with_forward_slashes() {
        let vault = temp_vault();
        fs::create_dir_all(vault.join("docs/notes")).unwrap();
        fs::write(vault.join("a.md"), b"# a").unwrap();
        fs::write(vault.join("docs/notes/b.md"), b"# b").unwrap();

        let entries = scan_vault(vault.to_str().unwrap()).unwrap();

        assert_eq!(
            rel_paths(&entries),
            vec!["a.md", "docs", "docs/notes", "docs/notes/b.md"]
        );
        let file = &entries[0];
        assert_eq!(file.size, 3);
        assert!(!file.is_dir);
        assert!(file.modified_ms > 0);

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn excludes_app_and_vcs_directories() {
        let vault = temp_vault();
        fs::create_dir_all(vault.join(".git")).unwrap();
        fs::create_dir_all(vault.join(".liber/trash")).unwrap();
        fs::create_dir_all(vault.join("node_modules/pkg")).unwrap();
        fs::write(vault.join(".git/config"), b"x").unwrap();
        fs::write(vault.join("keep.md"), b"x").unwrap();

        let entries = scan_vault(vault.to_str().unwrap()).unwrap();

        assert_eq!(rel_paths(&entries), vec!["keep.md"]);

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn sorts_entries_by_relative_path() {
        let vault = temp_vault();
        fs::write(vault.join("z.md"), b"x").unwrap();
        fs::write(vault.join("a.md"), b"x").unwrap();
        fs::create_dir_all(vault.join("m")).unwrap();

        let entries = scan_vault(vault.to_str().unwrap()).unwrap();

        assert_eq!(rel_paths(&entries), vec!["a.md", "m", "z.md"]);

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn errors_on_missing_or_non_directory_root() {
        let vault = temp_vault();
        fs::write(vault.join("file.md"), b"x").unwrap();

        assert!(scan_vault(vault.join("missing").to_str().unwrap()).is_err());
        assert!(scan_vault(vault.join("file.md").to_str().unwrap()).is_err());

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn returns_empty_for_empty_vault() {
        let vault = temp_vault();
        let entries = scan_vault(vault.to_str().unwrap()).unwrap();
        assert!(entries.is_empty());
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn writes_and_reads_roundtrip() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();

        write_file(root, "notes/a.md", "# hello").unwrap();

        assert_eq!(read_file(root, "notes/a.md").unwrap(), "# hello");
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn write_creates_parent_dirs_and_accepts_backslashes() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();

        write_file(root, "a\\b\\c.md", "x").unwrap();

        assert_eq!(read_file(root, "a/b/c.md").unwrap(), "x");
        assert!(vault.join("a/b/c.md").is_file());
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn write_overwrites_and_leaves_no_temp_files() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();

        write_file(root, "a.md", "one").unwrap();
        write_file(root, "a.md", "two").unwrap();

        assert_eq!(read_file(root, "a.md").unwrap(), "two");
        let names: Vec<String> = fs::read_dir(&vault)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.md".to_string()]);
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn rejects_traversal_and_missing_files() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();
        fs::write(vault.join("a.md"), b"x").unwrap();

        assert!(write_file(root, "../evil.md", "x").is_err());
        assert!(read_file(root, "missing.md").is_err());
        assert!(read_file(root, "").is_err());
        assert!(read_file(root, "..").is_err());
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn scans_large_vault_within_budget() {
        let vault = temp_vault();
        for index in 0..5000 {
            let dir = vault.join(format!("d{}", index / 100));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(format!("f{index}.md")), b"x").unwrap();
        }

        let started = std::time::Instant::now();
        let entries = scan_vault(vault.to_str().unwrap()).unwrap();
        let elapsed = started.elapsed();

        assert_eq!(entries.len(), 5050);
        assert!(
            elapsed.as_millis() < 1500,
            "vault scan exceeded budget: {elapsed:?}"
        );
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn parses_frontmatter_scalars_inline_lists_and_numbers() {
        let head = "---\nparent: Projects/Alpha\nalso_under: [Reference/Postgres, Areas/DB]\norder: 3.5\nhours: 12\ntags: [project-alpha]\n---\nbody";

        let frontmatter = super::parse_frontmatter(head).unwrap();

        assert_eq!(frontmatter.parent.as_deref(), Some("Projects/Alpha"));
        assert_eq!(
            frontmatter.also_under,
            vec!["Reference/Postgres", "Areas/DB"]
        );
        assert_eq!(frontmatter.order, Some(3.5));
        assert_eq!(frontmatter.tags, vec!["project-alpha"]);
        assert_eq!(frontmatter.numbers.get("hours"), Some(&12.0));
    }

    #[test]
    fn parses_dash_lists_and_quoted_values() {
        let head = "---\nparent: \"Quoted/Path\"\nalso_under:\n  - A/B\n  - C/D\ntags:\n  - one\n  - two\n---\n";

        let frontmatter = super::parse_frontmatter(head).unwrap();

        assert_eq!(frontmatter.parent.as_deref(), Some("Quoted/Path"));
        assert_eq!(frontmatter.also_under, vec!["A/B", "C/D"]);
        assert_eq!(frontmatter.tags, vec!["one", "two"]);
    }

    #[test]
    fn missing_frontmatter_returns_none() {
        assert!(super::parse_frontmatter("# just a heading\n").is_none());
    }

    #[test]
    fn counts_tasks_words_and_links() {
        let head = "Words here and more\n- [ ] open one\n  - [x] done nested\n* [X] done two\n+ [ ] open two\nSee [[Use Postgres|pg]] and [[Alpha]].\n";

        let metrics = super::count_metrics(head);

        assert_eq!(metrics.tasks_open, 2);
        assert_eq!(metrics.tasks_done, 2);
        assert_eq!(metrics.words, head.split_whitespace().count() as u32);
        assert_eq!(metrics.links, vec!["Use Postgres", "Alpha"]);
    }

    #[test]
    fn scan_includes_frontmatter_and_metrics() {
        let vault = temp_vault();
        fs::write(
            vault.join("note.md"),
            b"---\nparent: Projects/Alpha\norder: 2\n---\n- [ ] task\n[[Alpha]]\n",
        )
        .unwrap();

        let entries = scan_vault(vault.to_str().unwrap()).unwrap();
        let note = entries
            .iter()
            .find(|entry| entry.rel_path == "note.md")
            .unwrap();

        assert_eq!(note.frontmatter.parent.as_deref(), Some("Projects/Alpha"));
        assert_eq!(note.frontmatter.order, Some(2.0));
        assert_eq!(note.metrics.tasks_open, 1);
        assert_eq!(note.metrics.links, vec!["Alpha"]);

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn trash_and_restore_roundtrip() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();
        write_file(root, "docs/a.md", "x").unwrap();

        let trash_id = super::trash_move(root, "docs/a.md").unwrap();

        assert!(!vault.join("docs/a.md").exists());
        assert!(vault.join(".liber/trash").join(&trash_id).exists());
        assert!(scan_vault(root)
            .unwrap()
            .iter()
            .all(|entry| !entry.rel_path.contains("trash")));

        let restored = super::trash_restore(root, &trash_id).unwrap();
        assert_eq!(restored, "docs/a.md");
        assert_eq!(read_file(root, "docs/a.md").unwrap(), "x");

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn rename_and_duplicate_paths() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();
        write_file(root, "a.md", "one").unwrap();

        super::rename_path(root, "a.md", "docs/b.md").unwrap();
        assert_eq!(read_file(root, "docs/b.md").unwrap(), "one");
        assert!(super::rename_path(root, "docs/b.md", "docs/b.md").is_err());

        super::duplicate_path(root, "docs/b.md", "docs/c.md").unwrap();
        assert_eq!(read_file(root, "docs/c.md").unwrap(), "one");
        assert!(super::duplicate_path(root, "docs/c.md", "docs/b.md").is_err());

        super::create_dir(root, "docs/empty").unwrap();
        assert!(vault.join("docs/empty").is_dir());
        assert!(super::create_dir(root, "docs/empty").is_err());

        assert!(super::trash_restore(root, "../evil").is_err());
        assert!(super::trash_restore(root, "missing__file.md").is_err());

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn rejects_trash_ids_with_traversal() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();

        assert!(super::trash_restore(root, "../escape").is_err());
        assert!(super::trash_restore(root, "a/b").is_err());

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn parses_color_and_icon_frontmatter() {
        let head = "---\ncolor: \"#c0392b\"\nicon: \"*\"\n---\n";
        let frontmatter = super::parse_frontmatter(head).unwrap();
        assert_eq!(frontmatter.color.as_deref(), Some("#c0392b"));
        assert_eq!(frontmatter.icon.as_deref(), Some("*"));
    }

    #[test]
    fn extracts_image_references() {
        let head = "![shot](assets/a.png)\n![remote](https://x/y.png)\n![rel](../assets/b.jpg)\n";
        let metrics = super::count_metrics(head);
        assert_eq!(metrics.images, vec!["assets/a.png", "../assets/b.jpg"]);
    }

    #[test]
    fn trash_list_delete_and_empty() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();
        write_file(root, "a.md", "x").unwrap();
        write_file(root, "b.md", "y").unwrap();

        let first = super::trash_move(root, "a.md").unwrap();
        super::trash_move(root, "b.md").unwrap();
        assert_eq!(super::trash_list(root).unwrap().len(), 2);

        super::trash_delete(root, &first).unwrap();
        assert_eq!(super::trash_list(root).unwrap().len(), 1);
        assert!(super::trash_delete(root, "../escape").is_err());

        assert_eq!(super::trash_empty(root).unwrap(), 1);
        assert!(super::trash_list(root).unwrap().is_empty());

        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn writes_absolute_files() {
        let vault = temp_vault();
        let path = vault.join("out/export.html");
        super::write_absolute(path.to_str().unwrap(), "<html>").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "<html>");
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn extracts_open_task_items_with_line_numbers() {
        let head = "# title\n- [ ] first\n- [x] done\n  - [ ] second\n";
        let metrics = super::count_metrics(head);
        assert_eq!(metrics.tasks_open, 2);
        assert_eq!(metrics.tasks.len(), 2);
        assert_eq!(metrics.tasks[0].line, 2);
        assert_eq!(metrics.tasks[0].text, "first");
        assert_eq!(metrics.tasks[1].line, 4);
        assert_eq!(metrics.tasks[1].text, "second");
    }

    #[test]
    fn writes_binary_and_imports_external_files() {
        use base64::Engine;
        let vault = temp_vault();
        let root = vault.to_str().unwrap();

        let encoded = base64::engine::general_purpose::STANDARD.encode(b"binary-data");
        super::write_binary(root, "assets/a.bin", &encoded).unwrap();
        assert_eq!(
            fs::read(vault.join("assets/a.bin")).unwrap(),
            b"binary-data"
        );

        let source = vault.join("source.bin");
        fs::write(&source, b"imported").unwrap();
        super::import_external(root, source.to_str().unwrap(), "assets/b.bin").unwrap();
        assert_eq!(fs::read(vault.join("assets/b.bin")).unwrap(), b"imported");

        assert!(super::write_binary(root, "assets/c.bin", "not base64!!").is_err());
        fs::remove_dir_all(vault).unwrap();
    }

    #[test]
    fn searches_files_case_insensitively_with_line_numbers() {
        let vault = temp_vault();
        let root = vault.to_str().unwrap();
        write_file(root, "a.md", "First line\ncontains Alpha here\nlast\n").unwrap();
        write_file(root, "b.md", "nothing\n").unwrap();

        let hits = super::search_vault(root, "alpha", 50).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rel_path, "a.md");
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].text, "contains Alpha here");

        assert!(super::search_vault(root, "  ", 50).unwrap().is_empty());
        assert!(super::search_vault(root, "missing", 50).unwrap().is_empty());

        fs::remove_dir_all(vault).unwrap();
    }
}
