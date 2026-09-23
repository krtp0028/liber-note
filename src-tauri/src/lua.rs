use mlua::{Function, Lua, Table, Value};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaCommandMeta {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaKeymap {
    pub chord: String,
    pub command: String,
    pub context: String,
}

pub struct LuaHost {
    lua: Lua,
    commands: Vec<LuaCommandMeta>,
    keymaps: Vec<LuaKeymap>,
    messages: Arc<Mutex<Vec<String>>>,
}

fn lua_error(error: mlua::Error) -> String {
    error.to_string()
}

fn value_to_string(value: Value) -> Option<String> {
    match value {
        Value::String(text) => text.to_str().ok().map(|text| text.to_string()),
        Value::Nil => None,
        Value::Integer(number) => Some(number.to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Boolean(flag) => Some(flag.to_string()),
        _ => None,
    }
}

pub fn build(dir: &str) -> Result<LuaHost, String> {
    let lua = Lua::new();
    let commands_sink = Arc::new(Mutex::new(Vec::<LuaCommandMeta>::new()));
    let keymaps_sink = Arc::new(Mutex::new(Vec::<LuaKeymap>::new()));
    let messages_sink = Arc::new(Mutex::new(Vec::<String>::new()));

    let commands_table = lua.create_table().map_err(lua_error)?;
    let hooks_table = lua.create_table().map_err(lua_error)?;
    let mdtree = lua.create_table().map_err(lua_error)?;

    {
        let table = commands_table.clone();
        let sink = commands_sink.clone();
        let register = lua
            .create_function(move |_, options: Table| {
                let name: String = options.get("name")?;
                let description: String = options.get("description").unwrap_or_default();
                let action: Function = options.get("action")?;
                table.set(name.clone(), action)?;
                sink.lock()
                    .unwrap()
                    .push(LuaCommandMeta { name, description });
                Ok(())
            })
            .map_err(lua_error)?;
        mdtree.set("command", register).map_err(lua_error)?;
    }

    {
        let table = hooks_table.clone();
        let register = lua
            .create_function(move |_, (event, function): (String, Function)| {
                table.set(event, function)?;
                Ok(())
            })
            .map_err(lua_error)?;
        mdtree.set("on", register).map_err(lua_error)?;
    }

    {
        let sink = keymaps_sink.clone();
        let register = lua
            .create_function(
                move |_, (context, chord, command): (String, String, String)| {
                    sink.lock().unwrap().push(LuaKeymap {
                        chord,
                        command,
                        context,
                    });
                    Ok(())
                },
            )
            .map_err(lua_error)?;
        let keymap_table = lua.create_table().map_err(lua_error)?;
        keymap_table.set("set", register).map_err(lua_error)?;
        mdtree.set("keymap", keymap_table).map_err(lua_error)?;
    }

    {
        let sink = messages_sink.clone();
        let notify = lua
            .create_function(move |_, message: String| {
                sink.lock().unwrap().push(message);
                Ok(())
            })
            .map_err(lua_error)?;
        mdtree.set("notify", notify.clone()).map_err(lua_error)?;
        mdtree.set("log", notify).map_err(lua_error)?;
    }

    lua.globals().set("mdtree", mdtree).map_err(lua_error)?;

    let init_path = Path::new(dir).join("init.lua");
    if init_path.exists() {
        let source = fs::read_to_string(&init_path).map_err(|error| error.to_string())?;
        lua.load(&source)
            .set_name("init.lua")
            .exec()
            .map_err(|error| error.to_string())?;
    }

    lua.set_named_registry_value("liber_commands", commands_table)
        .map_err(lua_error)?;
    lua.set_named_registry_value("liber_hooks", hooks_table)
        .map_err(lua_error)?;

    let commands = commands_sink.lock().unwrap().clone();
    let keymaps = keymaps_sink.lock().unwrap().clone();

    Ok(LuaHost {
        lua,
        commands,
        keymaps,
        messages: messages_sink,
    })
}

impl LuaHost {
    pub fn commands(&self) -> &[LuaCommandMeta] {
        &self.commands
    }

    pub fn keymaps(&self) -> &[LuaKeymap] {
        &self.keymaps
    }

    pub fn run_command(&self, name: &str) -> Result<Option<String>, String> {
        let table: Table = self
            .lua
            .named_registry_value("liber_commands")
            .map_err(lua_error)?;
        let function: Function = table
            .get(name)
            .map_err(|_| format!("lua command not found: {name}"))?;
        let result: Value = function.call(()).map_err(lua_error)?;
        Ok(value_to_string(result))
    }

    pub fn run_hook(&self, event: &str, payload: &str) -> Result<Option<String>, String> {
        let table: Table = self
            .lua
            .named_registry_value("liber_hooks")
            .map_err(lua_error)?;
        let function: Function = match table.get(event) {
            Ok(function) => function,
            Err(_) => return Ok(None),
        };
        let result: Value = function.call(payload).map_err(lua_error)?;
        Ok(value_to_string(result))
    }

    pub fn drain_messages(&mut self) -> Vec<String> {
        std::mem::take(&mut self.messages.lock().unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::build;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_dir() -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("liber-lua-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn registers_commands_hooks_and_keymaps() {
        let dir = temp_dir();
        fs::write(
            dir.join("init.lua"),
            r#"
mdtree.command{
  name = "Insert date",
  description = "Insert the current date",
  action = function() return "2026-09-16" end,
}
mdtree.on("save", function(path)
  mdtree.notify("saved " .. path)
  return "hook-result"
end)
mdtree.keymap.set("global", "Ctrl+Alt+D", "lua:Insert date")
"#,
        )
        .unwrap();

        let mut host = build(dir.to_str().unwrap()).unwrap();

        assert_eq!(host.commands().len(), 1);
        assert_eq!(host.commands()[0].name, "Insert date");
        assert_eq!(host.keymaps()[0].chord, "Ctrl+Alt+D");
        assert_eq!(
            host.run_command("Insert date").unwrap().as_deref(),
            Some("2026-09-16")
        );
        assert_eq!(
            host.run_hook("save", "notes/a.md").unwrap().as_deref(),
            Some("hook-result")
        );
        assert!(host.run_hook("missing", "").unwrap().is_none());
        assert_eq!(host.drain_messages(), vec!["saved notes/a.md"]);
        assert!(host.drain_messages().is_empty());

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn syntax_errors_are_reported_without_panicking() {
        let dir = temp_dir();
        fs::write(dir.join("init.lua"), "this is not lua(").unwrap();

        let result = build(dir.to_str().unwrap());

        assert!(result.is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn large_init_script_loads_within_budget() {
        let dir = temp_dir();
        let mut script = String::new();
        for index in 0..1000 {
            script.push_str(&format!("-- filler line {index}\n"));
        }
        script
            .push_str("mdtree.command{ name = \"noop\", action = function() return \"ok\" end }\n");
        fs::write(dir.join("init.lua"), script).unwrap();

        let started = std::time::Instant::now();
        let host = build(dir.to_str().unwrap()).unwrap();
        let elapsed = started.elapsed();

        assert!(host.run_command("noop").unwrap().is_some());
        assert!(
            elapsed.as_millis() < 150,
            "lua init exceeded budget: {elapsed:?}"
        );

        fs::remove_dir_all(dir).unwrap();
    }
}
