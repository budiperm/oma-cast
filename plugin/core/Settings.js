// The settings view (SPEC §12 Phase 2 scope): pages of rows inside the
// launcher. ↵ on a row opens its options, flips a toggle or edits a number.
// Rows read and write two stores: settings.json `general` and config.json.

var PAGES = [
  { id: "general", title: "General", subtitle: "Window, keyboard and search", glyph: "" },          // nf-fa-cog
  { id: "commands", title: "Commands", subtitle: "Aliases, favourites, enable or disable", glyph: "" }, // nf-fa-list_ul
  { id: "calculator", title: "Calculator", subtitle: "Units, work time, clock, currency rates", glyph: "" }, // nf-fa-calculator
  { id: "scripts", title: "Script Commands", subtitle: "What was found in the script folder", glyph: "" }   // nf-oct-terminal
]

function choice(value, title) { return { value: value, title: title } }

// Option labels follow Raycast's settings pages (ref 04 App. B/C) where it
// has the setting [O]; the rest are ours [D].
var FIELDS = {
  general: [
    { key: "windowMode", store: "general", title: "Window Mode", subtitle: "Compact shows only the search bar until you type",
      options: [choice("expanded", "Expanded"), choice("compact", "Compact")] },
    { key: "escapeKeyBehavior", store: "general", title: "Escape Key", subtitle: "What Esc does with an empty search",
      options: [choice("pop-back-or-close", "Go Back or Close"), choice("close-and-pop-to-root", "Close and Pop to Root")] },
    { key: "popToRootTimeout", store: "general", title: "Pop to Root", subtitle: "Return to the root search after closing",
      options: [choice(0, "Immediately"), choice(5, "After 5 seconds"), choice(15, "After 15 seconds"), choice(30, "After 30 seconds"),
                choice(60, "After 1 minute"), choice(90, "After 90 seconds"), choice(120, "After 2 minutes"), choice(180, "After 3 minutes")] },
    { key: "navigationBindings", store: "general", title: "Navigation Bindings", subtitle: "Vim moves the action panel to Alt+K",
      options: [choice("emacs", "Emacs (Ctrl+N)"), choice("vim-motions", "Vim (Ctrl+J / Ctrl+K)")] },
    { key: "rootSearchSensitivity", store: "general", title: "Search Sensitivity", subtitle: "How loosely queries match",
      options: [choice("low", "Low"), choice("medium", "Medium"), choice("high", "High")] },
    { key: "uiZoom", store: "general", title: "Text Size", subtitle: "Also Ctrl + / Ctrl − / Ctrl 0",
      options: [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5].map(function(z) { return choice(z, Math.round(z * 100) + "%") }) },
    { key: "keepVisibleOnFocusLoss", store: "config", title: "Stay Open When Unfocused", subtitle: "Clicking outside doesn't close the launcher", type: "toggle" },
    { key: "logLevel", store: "config", title: "Log Level", subtitle: "What goes to the shell log",
      options: [choice("debug", "Debug"), choice("info", "Info"), choice("warning", "Warning"), choice("error", "Error")] }
  ],
  calculator: [
    { key: "currencyRates", store: "config", title: "Currency Rates", subtitle: "Daily ECB rates from frankfurter.dev, the only network request", type: "toggle" },
    { key: "remToPxRate", store: "config", title: "Pixels per rem", subtitle: "Used by 16px to rem", type: "number" },
    { key: "workHoursPerDay", store: "config", title: "Work Hours per Day", subtitle: "Used by work days and work weeks", type: "number" },
    { key: "clockFormat", store: "config", title: "Clock", subtitle: "How times are shown",
      options: [choice("auto", "System Default"), choice("12h", "12-hour"), choice("24h", "24-hour")] }
  ]
}

function field(page, key) {
  var list = FIELDS[page] || []
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i]
  return null
}

function fieldById(id) {
  var m = /^setting:(\w+)\.(\w+)$/.exec(String(id))
  return m ? field(m[1], m[2]) : null
}

function valueLabel(f, value) {
  if (f.type === "toggle") return value ? "On" : "Off"
  if (f.type === "number") return String(value)
  for (var i = 0; i < f.options.length; i++) if (f.options[i].value === value) return f.options[i].title
  return String(value)
}

function matches(query, texts) {
  var q = String(query || "").trim().toLowerCase()
  if (!q) return true
  return texts.join(" ").toLowerCase().indexOf(q) >= 0
}

function pageRows(query) {
  return PAGES.filter(function(p) { return matches(query, [p.title, p.subtitle]) }).map(function(p) {
    return { id: "settings-page:" + p.id, type: "command", kind: "settings-page", title: p.title, subtitle: p.subtitle,
             typeLabel: "", glyph: p.glyph, page: p.id }
  })
}

function fieldRows(page, query, general, config) {
  return (FIELDS[page] || []).filter(function(f) { return matches(query, [f.title, f.subtitle]) }).map(function(f) {
    var value = f.store === "general" ? general[f.key] : config[f.key]
    return { id: "setting:" + page + "." + f.key, type: "command", kind: "setting", title: f.title, subtitle: f.subtitle,
             typeLabel: valueLabel(f, value), control: f.type || "choice", value: value }
  })
}

// Commands page: every command (apps too), disabled ones included.
function commandRows(candidates, commands, query) {
  var out = []
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i]
    if (!matches(query, [c.title, c.subtitle, c.typeLabel])) continue
    var s = commands[c.id] || {}
    var notes = []
    if (s.alias) notes.push("Alias " + s.alias)
    if (typeof s.favoriteOrder === "number") notes.push("Favourite")
    out.push({ id: "command-setting:" + c.id, type: "command", kind: "command-setting", commandId: c.id,
               title: c.title, subtitle: notes.length ? notes.join(" · ") : c.subtitle,
               typeLabel: s.enabled === false ? "Disabled" : "Enabled", glyph: c.glyph || "", glyphFont: c.glyphFont || "",
               iconName: c.iconName || "", disabled: s.enabled === false, favoriteOrder: typeof s.favoriteOrder === "number" ? s.favoriteOrder : null,
               alias: s.alias || "" })
  }
  out.sort(function(a, b) { return (a.disabled === b.disabled ? 0 : a.disabled ? -1 : 1) || a.title.localeCompare(b.title) })
  return out
}

function scriptRows(directory, scripts, skipped, query) {
  var out = [
    { id: "scripts:open-folder", type: "command", kind: "scripts-action", title: "Open Script Folder", subtitle: directory, typeLabel: "", glyph: "" }, // nf-fa-folder_open
    { id: "scripts:reload", type: "command", kind: "scripts-action", title: "Reload Script Commands", subtitle: "Scan the folder again", typeLabel: "", glyph: "" } // nf-fa-refresh
  ].filter(function(r) { return matches(query, [r.title, r.subtitle]) })
  var modes = { fullOutput: "Full Output", compact: "Compact", silent: "Silent", inline: "Inline" }
  for (var i = 0; i < scripts.length; i++) {
    var s = scripts[i]
    if (!matches(query, [s.title, s.fileName])) continue
    out.push({ id: "script-file:" + s.fileName, type: "command", kind: "script-file", title: s.title, subtitle: s.fileName,
               typeLabel: modes[s.mode] || s.mode, glyph: "", path: s.path })
  }
  for (var j = 0; j < skipped.length; j++) {
    var k = skipped[j]
    if (!matches(query, [k.fileName, k.reason])) continue
    out.push({ id: "script-file:" + k.fileName, type: "command", kind: "script-file", title: k.fileName, subtitle: "Skipped: " + k.reason,
               typeLabel: "Skipped", glyph: "", disabled: true, path: k.path })   // nf-fa-warning
  }
  return out
}

// A typed number or option value → the stored value, or throws.
function parseValue(f, raw) {
  if (f.type === "toggle") return raw === true || raw === "true"
  if (f.type === "number") {
    var n = Number(String(raw).trim())
    if (!isFinite(n) || n <= 0) throw new Error(f.title + " must be a number above 0")
    return n
  }
  for (var i = 0; i < f.options.length; i++) if (String(f.options[i].value) === String(raw)) return f.options[i].value
  throw new Error(f.title + " can't be " + raw)
}

function actionsFor(row) {
  switch (row.kind) {
    case "settings-page": return [{ id: "open", title: "Open", shortcut: "↵", section: "primary", icon: "" }]
    case "setting":
      return [{ id: "open", title: row.control === "toggle" ? (row.value ? "Turn Off" : "Turn On") : row.control === "number" ? "Edit" : "Change", shortcut: "↵", section: "primary", icon: "" }]
    case "command-setting":
      return [
        { id: "open", title: row.disabled ? "Enable Command" : "Disable Command", shortcut: "↵", section: "primary", icon: "" },
        { id: "set-alias", title: row.alias ? "Change Alias" : "Set Alias", shortcut: "", section: "configure", icon: "" },
        { id: row.favoriteOrder === null ? "favorite-add" : "favorite-remove", title: row.favoriteOrder === null ? "Add to Favorites" : "Remove from Favorites", shortcut: "Ctrl Shift F", section: "favorites", icon: "" }
      ]
    case "scripts-action": return [{ id: "open", title: row.title, shortcut: "↵", section: "primary", icon: "" }]
    case "script-file": return [{ id: "open", title: "Edit Script", shortcut: "↵", section: "primary", icon: "" }]
  }
  return []
}

if (typeof module !== "undefined") {
  module.exports = {
    PAGES: PAGES,
    FIELDS: FIELDS,
    field: field,
    fieldById: fieldById,
    valueLabel: valueLabel,
    pageRows: pageRows,
    fieldRows: fieldRows,
    commandRows: commandRows,
    scriptRows: scriptRows,
    parseValue: parseValue,
    actionsFor: actionsFor
  }
}
