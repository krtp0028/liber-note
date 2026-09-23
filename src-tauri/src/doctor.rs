use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

use crate::vault::{self, FileMeta};

const KNOWN_KEYS: &[&str] = &[
    "parent",
    "also_under",
    "also-under",
    "tags",
    "order",
    "color",
    "icon",
];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];
const STALE_TASK_DAYS: i64 = 30;
const SNIPPET_MAX: usize = 240;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: String,
    pub severity: String,
    pub rel_path: String,
    pub line: u32,
    pub message: String,
    pub fix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub rel_path: String,
    pub action: String,
    pub summary: String,
    pub before: String,
    pub after: String,
    #[serde(skip)]
    pub contents: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub fix: String,
    pub count: usize,
    pub changes: Vec<Change>,
}

fn is_note(entry: &FileMeta) -> bool {
    !entry.is_dir
        && [".md", ".markdown", ".txt"]
            .iter()
            .any(|ext| entry.rel_path.to_lowercase().ends_with(ext))
}

fn notes(entries: &[FileMeta]) -> Vec<&FileMeta> {
    entries.iter().filter(|entry| is_note(entry)).collect()
}

fn parent_of(rel_path: &str) -> String {
    match rel_path.rfind('/') {
        Some(index) => rel_path[..index].to_string(),
        None => String::new(),
    }
}

fn file_name(rel_path: &str) -> String {
    match rel_path.rfind('/') {
        Some(index) => rel_path[index + 1..].to_string(),
        None => rel_path.to_string(),
    }
}

fn stem(rel_path: &str) -> String {
    let name = file_name(rel_path);
    match name.rfind('.') {
        Some(index) => name[..index].to_string(),
        None => name,
    }
}

fn extension(rel_path: &str) -> String {
    let name = file_name(rel_path);
    match name.rfind('.') {
        Some(index) => name[index + 1..].to_lowercase(),
        None => String::new(),
    }
}

fn is_asset(rel_path: &str) -> bool {
    let dir = parent_of(rel_path);
    (dir == "assets" || dir.starts_with("assets/"))
        && IMAGE_EXTENSIONS.contains(&extension(rel_path).as_str())
}

/// Frontmatter keys with their source line numbers and raw values.
fn frontmatter_keys(contents: &str) -> Vec<(u32, String, String)> {
    let mut keys = Vec::new();
    let mut lines = contents.lines().enumerate();
    if lines.next().map(|(_, line)| line.trim_end()) != Some("---") {
        return keys;
    }
    for (index, line) in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" {
            break;
        }
        if let Some(colon) = trimmed.find(':') {
            let key = trimmed[..colon].trim();
            if !key.is_empty() {
                keys.push((
                    index as u32 + 1,
                    key.to_string(),
                    trimmed[colon + 1..].trim().to_string(),
                ));
            }
        }
    }
    keys
}

fn resolve_links(entries: &[FileMeta], target: &str) -> Vec<String> {
    let needle = target.trim().trim_end_matches(".md").to_lowercase();
    let mut matches: Vec<String> = Vec::new();
    for entry in entries.iter().filter(|entry| is_note(entry)) {
        let rel = entry.rel_path.to_lowercase();
        let matches_target = rel == needle
            || rel.strip_suffix(".md") == Some(needle.as_str())
            || stem(&entry.rel_path).to_lowercase() == needle
            || file_name(&entry.rel_path).to_lowercase() == needle;
        if matches_target {
            matches.push(entry.rel_path.clone());
        }
    }
    matches.sort();
    matches.dedup();
    matches
}

fn relative_from(from_dir: &str, to_path: &str) -> String {
    let to_parts: Vec<&str> = to_path.split('/').filter(|part| !part.is_empty()).collect();
    let from_parts: Vec<&str> = from_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let shared = to_parts
        .iter()
        .zip(from_parts.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts: Vec<String> = vec!["..".to_string(); from_parts.len() - shared];
    parts.extend(to_parts[shared..].iter().map(|part| (*part).to_string()));
    parts.join("/")
}

fn snippet(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= SNIPPET_MAX {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(SNIPPET_MAX).collect();
    format!("{cut}…")
}

fn update(rel_path: &str, summary: &str, before: &str, after: &str) -> Change {
    Change {
        rel_path: rel_path.to_string(),
        action: "update".to_string(),
        summary: summary.to_string(),
        before: snippet(before),
        after: snippet(after),
        contents: Some(after.to_string()),
    }
}

fn payload_str(payload: &serde_json::Value, key: &str) -> String {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

fn replace_link(contents: &str, target: &str, replacement: &str, brackets: bool) -> String {
    let mut out = String::with_capacity(contents.len());
    let mut rest = contents;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else {
            out.push_str("[[");
            out.push_str(after);
            return out;
        };
        let inner = &after[..end];
        let (name, alias) = inner.split_once('|').unwrap_or((inner, ""));
        if name == target || name == format!("{target}.md") {
            if brackets {
                if alias.is_empty() {
                    out.push_str(&format!("[[{replacement}]]"));
                } else {
                    out.push_str(&format!("[[{replacement}|{alias}]]"));
                }
            } else {
                out.push_str(if alias.is_empty() { replacement } else { alias });
            }
        } else {
            out.push_str(&format!("[[{inner}]]"));
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

pub fn audit(root: &str) -> Result<Vec<Issue>, String> {
    let entries = vault::scan_vault(root)?;
    let note_list = notes(&entries);
    let mut issues = Vec::new();
    let mut referenced: HashSet<String> = HashSet::new();
    let mut linked: HashSet<String> = HashSet::new();
    let mut image_refs: HashSet<String> = HashSet::new();

    for entry in &note_list {
        let contents = vault::read_file(root, &entry.rel_path).unwrap_or_default();
        for (line, key, value) in frontmatter_keys(&contents) {
            let key_lower = key.to_lowercase();
            if !KNOWN_KEYS.contains(&key_lower.as_str()) {
                issues.push(Issue {
                    kind: "metadata-unknown-key".to_string(),
                    severity: "info".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line,
                    message: format!("unknown frontmatter key `{key}`"),
                    fix: Some("rename-key".to_string()),
                });
            }
            if key_lower == "order" {
                let unquoted = value.trim_matches(['"', '\'']);
                if unquoted != value || unquoted.parse::<f64>().is_err() {
                    issues.push(Issue {
                        kind: "metadata-type".to_string(),
                        severity: "warning".to_string(),
                        rel_path: entry.rel_path.clone(),
                        line,
                        message: format!("`order` is not a number: {value}"),
                        fix: Some("normalize".to_string()),
                    });
                }
            }
        }

        for target in &entry.metrics.links {
            let matches = resolve_links(&entries, target);
            if matches.is_empty() {
                issues.push(Issue {
                    kind: "link-dead".to_string(),
                    severity: "warning".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!("link `[[{target}]]` has no target"),
                    fix: Some("dead-links".to_string()),
                });
                continue;
            }
            if matches.len() > 1 {
                issues.push(Issue {
                    kind: "link-ambiguous".to_string(),
                    severity: "warning".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!("link `[[{target}]]` matches {}", matches.join(", ")),
                    fix: None,
                });
                continue;
            }
            let resolved = matches[0].clone();
            linked.insert(resolved.clone());
            if target.to_lowercase() != resolved.to_lowercase() {
                issues.push(Issue {
                    kind: "link-case".to_string(),
                    severity: "info".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!(
                        "`[[{target}]]` resolves only case-insensitively to {resolved}"
                    ),
                    fix: Some("link-case".to_string()),
                });
            }
        }

        for image in &entry.metrics.images {
            if image.starts_with("http") || image.starts_with("data:") {
                continue;
            }
            let resolved = normalize_join(&parent_of(&entry.rel_path), image);
            if !Path::new(root).join(&resolved).exists() {
                issues.push(Issue {
                    kind: "attachment-missing".to_string(),
                    severity: "warning".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!("image not found: {image}"),
                    fix: None,
                });
            } else {
                image_refs.insert(resolved);
            }
        }

        for mirror in &entry.frontmatter.also_under {
            let dir = mirror.trim_end_matches('/');
            if dir == parent_of(&entry.rel_path)
                || parent_of(&entry.rel_path).starts_with(&format!("{dir}/"))
            {
                issues.push(Issue {
                    kind: "mirror-redundant".to_string(),
                    severity: "info".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!("`also_under` {mirror} is already the note's own location"),
                    fix: Some("remove-mirrors".to_string()),
                });
            } else if !Path::new(root).join(dir).is_dir() {
                issues.push(Issue {
                    kind: "mirror-missing".to_string(),
                    severity: "warning".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!("`also_under` folder does not exist: {mirror}"),
                    fix: None,
                });
            } else {
                referenced.insert(dir.to_string());
            }
        }

        if entry.metrics.tasks_open > 0 && entry.modified_ms > 0 {
            let age_days = (now_ms() - entry.modified_ms) / 86_400_000;
            if age_days > STALE_TASK_DAYS {
                issues.push(Issue {
                    kind: "stale-tasks".to_string(),
                    severity: "info".to_string(),
                    rel_path: entry.rel_path.clone(),
                    line: 0,
                    message: format!(
                        "{} open task(s), untouched for {age_days} days",
                        entry.metrics.tasks_open
                    ),
                    fix: None,
                });
            }
        }
    }

    for entry in &note_list {
        let targeted = resolve_links(&entries, &entry.rel_path);
        let inbound = !targeted.is_empty() && linked.contains(&entry.rel_path);
        let mirrored = entry
            .frontmatter
            .also_under
            .iter()
            .any(|mirror| referenced.contains(mirror.trim_end_matches('/')));
        if !inbound && !mirrored && !entry.frontmatter.parent.is_some() {
            issues.push(Issue {
                kind: "orphan-note".to_string(),
                severity: "info".to_string(),
                rel_path: entry.rel_path.clone(),
                line: 0,
                message: "nothing links to this note".to_string(),
                fix: None,
            });
        }
    }

    let mut orders: HashMap<String, Vec<String>> = HashMap::new();
    for entry in &note_list {
        if let Some(order) = entry.frontmatter.order {
            orders
                .entry(format!("{}#{order}", parent_of(&entry.rel_path)))
                .or_default()
                .push(entry.rel_path.clone());
        }
    }
    for (siblings, paths) in orders {
        if paths.len() > 1 {
            for path in paths {
                issues.push(Issue {
                    kind: "order-conflict".to_string(),
                    severity: "info".to_string(),
                    rel_path: path,
                    line: 0,
                    message: format!("duplicate sibling order in {siblings}"),
                    fix: None,
                });
            }
        }
    }

    for entry in &note_list {
        if !is_asset(&entry.rel_path) {
            continue;
        }
        if !image_refs.contains(&entry.rel_path) {
            issues.push(Issue {
                kind: "attachment-orphan".to_string(),
                severity: "info".to_string(),
                rel_path: entry.rel_path.clone(),
                line: 0,
                message: "asset is not referenced by any note".to_string(),
                fix: None,
            });
        }
    }

    for (_, duplicates) in duplicate_assets(root, &entries) {
        for duplicate in duplicates {
            issues.push(Issue {
                kind: "attachment-duplicate".to_string(),
                severity: "warning".to_string(),
                rel_path: duplicate,
                line: 0,
                message: "identical asset already exists in the vault".to_string(),
                fix: Some("dedupe-assets".to_string()),
            });
        }
    }

    Ok(issues)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_join(base: &str, relative: &str) -> String {
    let mut parts: Vec<String> = base
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .map(|part| part.to_string())
        .collect();
    for part in relative.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other.to_string()),
        }
    }
    parts.join("/")
}

fn duplicate_assets(root: &str, entries: &[FileMeta]) -> Vec<(String, Vec<String>)> {
    let mut groups: HashMap<(u64, u64), Vec<String>> = HashMap::new();
    for entry in entries.iter().filter(|entry| is_asset(&entry.rel_path)) {
        let Ok(bytes) = fs::read(Path::new(root).join(&entry.rel_path)) else {
            continue;
        };
        let mut hasher = DefaultHasher::new();
        bytes.hash(&mut hasher);
        groups
            .entry((entry.size, hasher.finish()))
            .or_default()
            .push(entry.rel_path.clone());
    }
    let mut result: Vec<(String, Vec<String>)> = groups
        .into_values()
        .filter(|paths| paths.len() > 1)
        .map(|mut paths| {
            paths.sort();
            let keeper = paths.remove(0);
            (keeper, paths)
        })
        .collect();
    result.sort();
    result
}

pub fn plan(root: &str, fix: &str, payload: &serde_json::Value) -> Result<Plan, String> {
    let entries = vault::scan_vault(root)?;
    let changes = match fix {
        "rename-key" => plan_rename_key(root, &entries, payload)?,
        "normalize" => plan_normalize(root, &entries)?,
        "remove-mirrors" => plan_remove_mirrors(root, &entries)?,
        "dead-links" => plan_dead_links(root, &entries, payload_str(payload, "mode"))?,
        "dedupe-assets" => plan_dedupe_assets(root, &entries)?,
        "link-case" => plan_link_case(root, &entries)?,
        other => return Err(format!("unknown fix: {other}")),
    };
    Ok(Plan {
        fix: fix.to_string(),
        count: changes.len(),
        changes,
    })
}

pub fn apply(root: &str, fix: &str, payload: &serde_json::Value) -> Result<usize, String> {
    let plan = plan(root, fix, payload)?;
    let count = plan.count;
    for change in plan
        .changes
        .iter()
        .filter(|change| change.action != "trash")
    {
        let contents = change
            .contents
            .as_deref()
            .ok_or_else(|| format!("missing contents for {}", change.rel_path))?;
        vault::write_file(root, &change.rel_path, contents)?;
    }
    for change in plan
        .changes
        .iter()
        .filter(|change| change.action == "trash")
    {
        vault::trash_move(root, &change.rel_path)?;
    }
    Ok(count)
}

fn plan_rename_key(
    root: &str,
    entries: &[FileMeta],
    payload: &serde_json::Value,
) -> Result<Vec<Change>, String> {
    let from = payload_str(payload, "from");
    let to = payload_str(payload, "to");
    if from.is_empty() || to.is_empty() {
        return Err("rename-key needs `from` and `to`".to_string());
    }
    let mut changes = Vec::new();
    for entry in notes(entries) {
        let contents = vault::read_file(root, &entry.rel_path)?;
        let keys = frontmatter_keys(&contents);
        if !keys.iter().any(|(_, key, _)| key == &from) || keys.iter().any(|(_, key, _)| key == &to)
        {
            continue;
        }
        let updated = contents
            .lines()
            .map(|line| {
                if line.trim_start().starts_with(&format!("{from}:")) {
                    line.replacen(&format!("{from}:"), &format!("{to}:"), 1)
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<String>>()
            .join("\n");
        let updated = if contents.ends_with('\n') {
            format!("{updated}\n")
        } else {
            updated
        };
        changes.push(update(
            &entry.rel_path,
            &format!("{from} → {to}"),
            &contents,
            &updated,
        ));
    }
    Ok(changes)
}

fn plan_normalize(root: &str, entries: &[FileMeta]) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for entry in notes(entries) {
        let contents = vault::read_file(root, &entry.rel_path)?;
        let mut lines: Vec<String> = contents
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .lines()
            .map(|line| {
                let trimmed = line.trim_end().to_string();
                let colon = trimmed.find(':');
                match colon {
                    Some(index) => {
                        let key = trimmed[..index].trim().to_lowercase();
                        let value = trimmed[index + 1..].trim();
                        if key == "order" || value.parse::<f64>().is_ok() {
                            let unquoted = value.trim_matches(['"', '\'']);
                            if unquoted != value && unquoted.parse::<f64>().is_ok() {
                                return format!("{}: {unquoted}", trimmed[..index].trim_end());
                            }
                        }
                        trimmed
                    }
                    None => trimmed,
                }
            })
            .collect();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        let updated = format!("{}\n", lines.join("\n"));
        if updated != contents {
            let summary = if contents.contains('\r') {
                "normalized line endings and whitespace"
            } else {
                "trimmed trailing whitespace"
            };
            changes.push(update(&entry.rel_path, summary, &contents, &updated));
        }
    }
    Ok(changes)
}

fn plan_remove_mirrors(root: &str, entries: &[FileMeta]) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for entry in notes(entries) {
        if entry.frontmatter.also_under.is_empty() {
            continue;
        }
        let own = parent_of(&entry.rel_path);
        let kept: Vec<String> = entry
            .frontmatter
            .also_under
            .iter()
            .filter(|mirror| {
                let dir = mirror.trim_end_matches('/');
                dir != own && !own.starts_with(&format!("{dir}/"))
            })
            .cloned()
            .collect();
        if kept.len() == entry.frontmatter.also_under.len() {
            continue;
        }
        let contents = vault::read_file(root, &entry.rel_path)?;
        let updated = rewrite_also_under(&contents, &kept);
        changes.push(update(
            &entry.rel_path,
            "removed redundant also_under entries",
            &contents,
            &updated,
        ));
    }
    Ok(changes)
}

fn rewrite_also_under(contents: &str, kept: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut skipping_items = false;
    for line in contents.lines() {
        let trimmed = line.trim_start();
        let (key, inline) = trimmed.split_once(':').unwrap_or((trimmed, ""));
        let is_also_under =
            key.trim().to_lowercase() == "also_under" || key.trim().to_lowercase() == "also-under";
        if is_also_under && inline.trim().is_empty() {
            skipping_items = true;
            continue;
        }
        if is_also_under {
            let indent = &line[..line.len() - trimmed.len()];
            out.push(format!("{indent}also_under: [{}]", kept.join(", ")));
            continue;
        }
        if skipping_items && trimmed.starts_with("- ") {
            continue;
        }
        if skipping_items && !trimmed.starts_with("- ") {
            skipping_items = false;
        }
        out.push(line.to_string());
    }
    format!("{}\n", out.join("\n"))
}

fn plan_dead_links(root: &str, entries: &[FileMeta], mode: String) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for entry in notes(entries) {
        let contents = vault::read_file(root, &entry.rel_path)?;
        let mut updated = contents.clone();
        for target in &entry.metrics.links {
            if !resolve_links(entries, target).is_empty() {
                continue;
            }
            let label = if target.contains('/') {
                stem(target)
            } else {
                target.clone()
            };
            match mode.as_str() {
                "plain" => {
                    updated = replace_link(&updated, target, &label, false);
                }
                _ => {
                    let dir = parent_of(&entry.rel_path);
                    let path = if target.contains('/') || dir.is_empty() {
                        format!("{target}.md")
                    } else {
                        format!("{dir}/{target}.md")
                    };
                    if Path::new(root).join(&path).exists() {
                        continue;
                    }
                    changes.push(Change {
                        rel_path: path.clone(),
                        action: "create".to_string(),
                        summary: format!("stub for [[{target}]]"),
                        before: String::new(),
                        after: format!("# {label}\n"),
                        contents: Some(format!("# {label}\n")),
                    });
                }
            }
        }
        if updated != contents {
            changes.push(update(
                &entry.rel_path,
                "dead links replaced with plain text",
                &contents,
                &updated,
            ));
        }
    }
    Ok(changes)
}

fn plan_link_case(root: &str, entries: &[FileMeta]) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for entry in notes(entries) {
        let contents = vault::read_file(root, &entry.rel_path)?;
        let mut updated = contents.clone();
        let mut touched = false;
        for target in &entry.metrics.links {
            let matches = resolve_links(entries, target);
            if matches.len() != 1 {
                continue;
            }
            let resolved = matches[0].clone();
            if target == &resolved || target.eq_ignore_ascii_case(&resolved) {
                continue;
            }
            let exact = stem(&resolved);
            if target.to_lowercase() != exact.to_lowercase() {
                continue;
            }
            updated = replace_link(&updated, target, &exact, true);
            touched = true;
        }
        if touched {
            changes.push(update(
                &entry.rel_path,
                "link casing matched to the real file name",
                &contents,
                &updated,
            ));
        }
    }
    Ok(changes)
}

fn plan_dedupe_assets(root: &str, entries: &[FileMeta]) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for (keeper, duplicates) in duplicate_assets(root, entries) {
        for duplicate in &duplicates {
            for entry in notes(entries) {
                let contents = vault::read_file(root, &entry.rel_path)?;
                let mut updated = contents.clone();
                for image in &entry.metrics.images {
                    if normalize_join(&parent_of(&entry.rel_path), image) != *duplicate {
                        continue;
                    }
                    updated = updated
                        .replace(image, &relative_from(&parent_of(&entry.rel_path), &keeper));
                }
                if updated != contents {
                    changes.push(update(
                        &entry.rel_path,
                        &format!("point at {keeper} instead of {duplicate}"),
                        &contents,
                        &updated,
                    ));
                }
            }
            changes.push(Change {
                rel_path: duplicate.clone(),
                action: "trash".to_string(),
                summary: format!("duplicate of {keeper}"),
                before: String::new(),
                after: String::new(),
                contents: None,
            });
        }
    }
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::{audit, frontmatter_keys, plan, resolve_links};
    use crate::vault::{scan_vault, write_file};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_vault() -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path =
            std::env::temp_dir().join(format!("liber-doctor-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write(root: &PathBuf, rel: &str, contents: &str) {
        write_file(&root.to_string_lossy(), rel, contents).unwrap();
    }

    fn payload(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn finds_unknown_keys_and_dead_links() {
        let root = temp_vault();
        write(
            &root,
            "A.md",
            "---\ntag: [x]\norder: \"2\"\n---\nbody [[Missing]]\n",
        );
        let issues = audit(&root.to_string_lossy()).unwrap();
        let kinds: Vec<&str> = issues.iter().map(|issue| issue.kind.as_str()).collect();

        assert!(kinds.contains(&"metadata-unknown-key"));
        assert!(kinds.contains(&"metadata-type"));
        assert!(kinds.contains(&"link-dead"));
    }

    #[test]
    fn renames_a_key_across_the_vault() {
        let root = temp_vault();
        write(&root, "A.md", "---\ntag: [x]\n---\n");
        write(&root, "B.md", "---\ntags: [y]\ntag: [z]\n---\n");

        let plan = plan(
            &root.to_string_lossy(),
            "rename-key",
            &payload(r#"{"from":"tag","to":"tags"}"#),
        )
        .unwrap();
        assert_eq!(plan.count, 1, "B.md has both keys and must be skipped");
        assert_eq!(plan.changes[0].rel_path, "A.md");
    }

    #[test]
    fn normalizes_line_endings_and_trailing_space() {
        let root = temp_vault();
        write(
            &root,
            "A.md",
            "---\r\norder: \"3\"\r\n---\r\nbody   \r\n\r\n\r\n",
        );

        let plan = plan(&root.to_string_lossy(), "normalize", &payload("{}")).unwrap();
        assert_eq!(plan.count, 1);
        let after = plan.changes[0].contents.clone().unwrap();
        assert_eq!(after, "---\norder: 3\n---\nbody\n");
    }

    #[test]
    fn removes_mirrors_that_match_the_notes_own_folder() {
        let root = temp_vault();
        write(&root, "Docs/A.md", "---\nalso_under: [Docs, Other]\n---\n");
        fs::create_dir_all(root.join("Other")).unwrap();

        let plan = plan(&root.to_string_lossy(), "remove-mirrors", &payload("{}")).unwrap();
        assert_eq!(plan.count, 1);
        let after = plan.changes[0].contents.clone().unwrap();
        assert!(after.contains("also_under: [Other]"), "{after}");
    }

    #[test]
    fn downgrades_dead_links_to_plain_text() {
        let root = temp_vault();
        write(&root, "A.md", "see [[Ghost|ghost note]] and [[Ghost]]\n");

        let plan = plan(
            &root.to_string_lossy(),
            "dead-links",
            &payload(r#"{"mode":"plain"}"#),
        )
        .unwrap();
        let after = plan.changes[0].contents.clone().unwrap();
        assert_eq!(after, "see ghost note and Ghost\n");
    }

    #[test]
    fn creates_stubs_for_dead_links() {
        let root = temp_vault();
        write(&root, "A.md", "see [[Ghost]]\n");

        let plan = plan(
            &root.to_string_lossy(),
            "dead-links",
            &payload(r#"{"mode":"stub"}"#),
        )
        .unwrap();
        assert_eq!(plan.changes[0].rel_path, "Ghost.md");
        assert_eq!(plan.changes[0].action, "create");
    }

    #[test]
    fn fixes_link_casing_and_finds_duplicates() {
        let root = temp_vault();
        write(&root, "Postgres.md", "# db\n");
        write(&root, "B.md", "see [[postgres]]\n");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/a.png"), b"same").unwrap();
        fs::write(root.join("assets/b.png"), b"same").unwrap();
        write(&root, "C.md", "![x](assets/a.png)\n");

        let case = plan(&root.to_string_lossy(), "link-case", &payload("{}")).unwrap();
        assert_eq!(
            case.changes[0].contents.clone().unwrap(),
            "see [[Postgres]]\n"
        );

        let dedupe = plan(&root.to_string_lossy(), "dedupe-assets", &payload("{}")).unwrap();
        let trashed: Vec<&str> = dedupe
            .changes
            .iter()
            .filter(|change| change.action == "trash")
            .map(|change| change.rel_path.as_str())
            .collect();
        assert_eq!(trashed, vec!["assets/b.png"]);
    }

    #[test]
    fn resolves_links_by_path_stem_and_filename() {
        let root = temp_vault();
        write(&root, "Ref/Db.md", "# db\n");
        let entries = scan_vault(&root.to_string_lossy()).unwrap();

        assert_eq!(resolve_links(&entries, "Ref/Db"), vec!["Ref/Db.md"]);
        assert_eq!(resolve_links(&entries, "Db"), vec!["Ref/Db.md"]);
        assert!(resolve_links(&entries, "Nope").is_empty());
    }

    #[test]
    fn reads_frontmatter_keys_with_line_numbers() {
        let keys = frontmatter_keys("---\ntags: [a]\norder: 1\n---\nbody: not frontmatter\n");
        assert_eq!(keys[0], (2, "tags".to_string(), "[a]".to_string()));
        assert_eq!(keys.len(), 2);
    }
}
