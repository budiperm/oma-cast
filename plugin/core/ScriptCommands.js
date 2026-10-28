// Script Commands (SPEC §9.9, ref 03 §5): executables with `@raycast.*`
// comment headers in $XDG_CONFIG_HOME/oma-cast/script-commands become
// root-search commands. One directory, scanned non-recursively [D].

var HEADER = /^(?:#|REM|::|\/{2})\s*@raycast\.(\w+)\s+(.*)$/i
var MAX_BYTES = 2 * 1024 * 1024
var MIN_REFRESH_SECONDS = 10
var ARGUMENT_TYPES = { text: true, password: true, dropdown: true }

// The scan: one record per file, \x1e-separated, fields \x1f-separated:
// path, status ("ok" or why it was skipped), then the first 16 KB for "ok".
// $1 is the directory. [O skip rules: dirs, > 2 MB, empty, .template., not +x]
var SCAN_SCRIPT = [
  'shopt -s nullglob dotglob',
  'for f in "$1"/*; do',
  '  [[ -d $f ]] && continue',
  '  name=${f##*/}',
  '  [[ $name == .* ]] && continue',
  '  size=$(stat -Lc %s -- "$f" 2>/dev/null) || continue',
  '  if [[ $name == *.template.* ]]; then reason="template"',
  '  elif (( size == 0 )); then reason="empty file"',
  '  elif (( size > ' + MAX_BYTES + ' )); then reason="larger than 2 MB"',
  '  elif [[ ! -x $f ]]; then reason="not executable (chmod +x)"',
  '  else reason=ok; fi',
  '  printf "\\036%s\\037%s\\037" "$f" "$reason"',
  '  [[ $reason == ok ]] && head -c 16384 -- "$f"',
  'done',
  'exit 0'
].join("\n")

function parseScan(output) {
  var out = []
  var records = String(output || "").split("\x1e")
  for (var i = 0; i < records.length; i++) {
    if (!records[i]) continue
    var parts = records[i].split("\x1f")
    if (parts.length < 2) continue
    out.push({ path: parts[0], status: parts[1], text: parts.slice(2).join("\x1f") })
  }
  return out
}

function baseName(path) { return String(path).replace(/\/+$/, "").replace(/^.*\//, "") }
function dirName(path) { var p = String(path); var i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/" }

function titleCase(s) {
  return String(s).replace(/[-_]+/g, " ").replace(/(^|\s)([a-z])/g, function(_, a, b) { return a + b.toUpperCase() })
}

// "30s", "5m", "1h", "1d" → seconds, at least 10 [O]; null if malformed.
function parseRefresh(value) {
  var m = /^(\d+)(s|m|h|d)$/.exec(String(value || "").trim())
  if (!m) return null
  var seconds = Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]
  return Math.max(MIN_REFRESH_SECONDS, seconds)
}

function parseArgument(name, raw) {
  var spec
  try { spec = JSON.parse(raw) } catch (e) { throw new Error(name + " is not JSON") }
  if (!spec || typeof spec !== "object") throw new Error(name + " is not an object")
  var type = String(spec.type || "text")
  if (!ARGUMENT_TYPES[type]) throw new Error(name + " has unknown type " + type)
  var arg = {
    name: name,
    type: type,
    placeholder: String(spec.placeholder || name),
    required: spec.optional !== true,
    percentEncoded: spec.percentEncoded === true,
    data: []
  }
  if (type === "dropdown") {
    if (!Array.isArray(spec.data) || spec.data.length === 0) throw new Error(name + " is a dropdown without data")
    arg.data = spec.data.map(function(d) { return { title: String(d.title !== undefined ? d.title : d.value), value: String(d.value) } })
  }
  return arg
}

// Header → script, or throws with the reason the Scripts settings page shows.
function parseScript(path, text) {
  var keys = {}
  var lines = String(text || "").split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    var m = HEADER.exec(lines[i].trim())
    if (m) keys[m[1].toLowerCase()] = m[2].trim()
  }
  if (keys.schemaversion !== "1") throw new Error(keys.schemaversion ? "schemaVersion must be 1" : "missing @raycast.schemaVersion 1")
  if (!keys.title) throw new Error("missing @raycast.title")
  if (!keys.mode) throw new Error("missing @raycast.mode")

  var mode = { fulloutput: "fullOutput", "full-output": "fullOutput", compact: "compact", silent: "silent", inline: "inline" }[keys.mode.toLowerCase()]
  if (!mode) throw new Error("unknown mode " + keys.mode)
  var refreshSeconds = null
  if (keys.refreshtime) {
    refreshSeconds = parseRefresh(keys.refreshtime)
    if (refreshSeconds === null) throw new Error("refreshTime must look like 10s, 5m, 1h or 1d")
  }
  if (mode === "inline" && refreshSeconds === null) mode = "compact"     // [O]
  if (mode !== "inline") refreshSeconds = null

  var args = []
  if (mode !== "inline") {
    for (var n = 1; n <= 3; n++) if (keys["argument" + n]) args.push(parseArgument("argument" + n, keys["argument" + n]))
  }

  var fileName = baseName(path)
  var dir = dirName(path)
  return {
    id: "script:" + fileName,
    path: path,
    fileName: fileName,
    title: keys.title,
    mode: mode,
    packageName: keys.packagename || titleCase(baseName(dir)),
    icon: keys.icon || "",
    description: keys.description || "",
    author: keys.author || "",
    cwd: keys.currentdirectorypath ? resolvePath(dir, keys.currentdirectorypath) : dir,
    needsConfirmation: mode !== "inline" && String(keys.needsconfirmation).toLowerCase() === "true",
    refreshSeconds: refreshSeconds,
    arguments: args
  }
}

function resolvePath(dir, rel) {
  var r = String(rel)
  if (r.charAt(0) === "~") return r
  if (r.charAt(0) === "/") return r
  var parts = (dir + "/" + r).split("/")
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "" || parts[i] === ".") continue
    if (parts[i] === "..") out.pop()
    else out.push(parts[i])
  }
  return "/" + out.join("/")
}

// Every scanned file: scripts that parsed, and the rest with a reason.
function load(scanOutput) {
  var scripts = [], skipped = []
  var records = parseScan(scanOutput)
  for (var i = 0; i < records.length; i++) {
    var r = records[i]
    if (r.status !== "ok") { skipped.push({ path: r.path, fileName: baseName(r.path), reason: r.status }); continue }
    try { scripts.push(parseScript(r.path, r.text)) } catch (e) {
      skipped.push({ path: r.path, fileName: baseName(r.path), reason: e.message })
    }
  }
  scripts.sort(function(a, b) { return a.title.localeCompare(b.title) })
  return { scripts: scripts, skipped: skipped }
}

// An emoji or short symbol icon is drawn as a glyph, a file as an image.
// Icon URLs are ignored: oma-cast fetches nothing (SPEC §0). [D]
function iconFor(script) {
  var icon = script.icon
  if (!icon || /^https?:/i.test(icon)) return { glyph: "", iconName: "" }
  if (/\.(png|svg|jpe?g)$/i.test(icon)) return { glyph: "", iconName: resolvePath(dirName(script.path), icon) }
  return icon.length <= 4 ? { glyph: icon, iconName: "" } : { glyph: "", iconName: "" }
}

function candidate(script, inlineText) {
  var icon = iconFor(script)
  var keywords = [script.packageName]
  if (script.description) keywords.push(script.description)
  return {
    id: script.id,
    type: "command",
    kind: "script",
    title: script.title,
    subtitle: script.mode === "inline" && inlineText ? inlineText : script.packageName,
    keywords: keywords,
    typeLabel: "Script Command",
    glyph: icon.glyph || (icon.iconName ? "" : ""),          // nf-oct-terminal
    glyphFont: "",
    iconName: icon.iconName,
    arguments: script.arguments,
    scriptPath: script.path,
    mode: script.mode,
    needsConfirmation: script.needsConfirmation,
    rootSearch: { when: "always" }
  }
}

// Positional $1..$3 for the declared arguments; empty optional ones stay "".
function argv(script, values) {
  var out = [script.path]
  for (var i = 0; i < script.arguments.length; i++) {
    var a = script.arguments[i]
    var v = String((values && values[a.name]) || "")
    if (a.required && !v.trim()) throw new Error("Fill in " + a.placeholder)
    if (a.type === "dropdown" && v && !a.data.some(function(d) { return d.value === v })) throw new Error(a.placeholder + ": pick one of the options")
    out.push(a.percentEncoded ? encodeURIComponent(v) : v)
  }
  return out
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
}

function lines(text) {
  return stripAnsi(text).split(/\r?\n/).map(function(l) { return l.trim() }).filter(function(l) { return l })
}

function lastLine(text) { var l = lines(text); return l.length ? l[l.length - 1] : "" }
function firstLine(text) { var l = lines(text); return l.length ? l[0] : "" }

if (typeof module !== "undefined") {
  module.exports = {
    HEADER: HEADER,
    SCAN_SCRIPT: SCAN_SCRIPT,
    parseScan: parseScan,
    parseRefresh: parseRefresh,
    parseScript: parseScript,
    load: load,
    candidate: candidate,
    iconFor: iconFor,
    argv: argv,
    stripAnsi: stripAnsi,
    lastLine: lastLine,
    firstLine: firstLine
  }
}
