const test = require("node:test")
const assert = require("node:assert/strict")
const Settings = require("../plugin/core/Settings.js")
const Schema = require("../plugin/core/Schema.js")

const general = Schema.settingsMigrations[0].up({}).general
const config = Schema.withConfigDefaults(null)

test("every settings field maps to a real setting and valid options", () => {
  for (const [page, fields] of Object.entries(Settings.FIELDS)) {
    for (const f of fields) {
      const store = f.store === "general" ? general : config
      assert.ok(f.key in store, `${page}.${f.key} exists in ${f.store}`)
      if (f.options) {
        assert.ok(f.options.some((o) => o.value === store[f.key]), `${f.key} default is one of its options`)
        const allowed = f.store === "general" ? Schema.generalChoices[f.key] : null
        if (allowed) for (const o of f.options) assert.ok(allowed.includes(o.value), `${f.key}=${o.value} is allowed`)
        if (f.store === "config") for (const o of f.options) assert.ok(Schema.withConfigDefaults({ [f.key]: o.value })[f.key] === o.value, `${f.key}=${o.value} survives config validation`)
      }
    }
  }
})

test("rows show the current value and filter by the query", () => {
  const rows = Settings.fieldRows("general", "", { ...general, navigationBindings: "vim-motions" }, config)
  const nav = rows.find((r) => r.id === "setting:general.navigationBindings")
  assert.equal(nav.typeLabel, "Vim (Ctrl+J / Ctrl+K)")
  assert.equal(rows.find((r) => r.id === "setting:general.keepVisibleOnFocusLoss").typeLabel, "Off")
  assert.deepEqual(Settings.fieldRows("calculator", "rem", general, config).map((r) => r.title), ["Pixels per rem"])
  assert.deepEqual(Settings.pageRows("calc").map((r) => r.page), ["calculator"])
  assert.equal(Settings.fieldById("setting:calculator.clockFormat").title, "Clock")
  assert.equal(Settings.fieldById("setting:nope.x"), null)
})

test("parseValue validates numbers and options", () => {
  const rem = Settings.field("calculator", "remToPxRate")
  assert.equal(Settings.parseValue(rem, " 10 "), 10)
  assert.throws(() => Settings.parseValue(rem, "0"), /above 0/)
  assert.throws(() => Settings.parseValue(rem, "abc"), /above 0/)
  const pop = Settings.field("general", "popToRootTimeout")
  assert.equal(Settings.parseValue(pop, "30"), 30)
  assert.throws(() => Settings.parseValue(pop, "31"), /can't be 31/)
  assert.equal(Settings.parseValue(Settings.field("calculator", "currencyRates"), false), false)
})

test("commands page lists disabled commands first, with alias and favourite notes", () => {
  const candidates = [
    { id: "app:firefox", title: "Firefox", subtitle: "", typeLabel: "Application" },
    { id: "omarchy:system.lock", title: "Lock", subtitle: "System", typeLabel: "Command" },
    { id: "builtin:calculator-history", title: "Calculator History", subtitle: "Calculator", typeLabel: "Command" }
  ]
  const commands = { "omarchy:system.lock": { enabled: false }, "app:firefox": { alias: "ff", favoriteOrder: 0 } }
  const rows = Settings.commandRows(candidates, commands, "")
  assert.deepEqual(rows.map((r) => [r.title, r.typeLabel]), [["Lock", "Disabled"], ["Calculator History", "Enabled"], ["Firefox", "Enabled"]])
  assert.equal(rows[2].subtitle, "Alias ff · Favourite")
  assert.equal(Settings.actionsFor(rows[0])[0].title, "Enable Command")
  assert.equal(Settings.actionsFor(rows[2])[2].id, "favorite-remove")
})

test("scripts page shows folder actions, scripts and skipped files", () => {
  const rows = Settings.scriptRows("/s", [{ title: "Hello", fileName: "hello.sh", mode: "fullOutput", path: "/s/hello.sh" }],
    [{ fileName: "bad.sh", reason: "missing @raycast.title", path: "/s/bad.sh" }], "")
  assert.deepEqual(rows.map((r) => r.id), ["scripts:open-folder", "scripts:reload", "script-file:hello.sh", "script-file:bad.sh"])
  assert.equal(rows[3].subtitle, "Skipped: missing @raycast.title")
  assert.equal(rows[2].typeLabel, "Full Output")
})
