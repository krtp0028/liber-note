-- Example init.lua for Liber. Copy to your config directory
-- (%APPDATA%\liber\init.lua on Windows) and reload the app.

-- 1. Custom command: its return value is inserted at the cursor.
mdtree.command{
  name = "Insert date",
  description = "Insert today's date",
  action = function()
    return os.date("%Y-%m-%d")
  end,
}

-- 2. Hook: annotate new notes with frontmatter.
mdtree.on("new_note", function(path)
  return "---\ntags: [inbox]\n---"
end)

-- 3. Hook: log saves to the status area.
mdtree.on("save", function(path)
  mdtree.notify("saved " .. path)
end)

-- 4. Keymap: bind the command.
mdtree.keymap.set("global", "Ctrl+Alt+D", "Insert date")
