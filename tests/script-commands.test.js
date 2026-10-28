const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const SC = require("../plugin/core/ScriptCommands.js")

// Shaped like the raycast/script-commands samples.
const samples = {
  "hello.sh": `#!/bin/bash
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Hello World
# @raycast.mode fullOutput
# Optional parameters:
# @raycast.icon 👋
# @raycast.packageName Greetings
echo "Hello"
`,
  "weather.py": `#!/usr/bin/env python3
# @raycast.schemaVersion 1
# @raycast.title Uptime
# @raycast.mode inline
# @raycast.refreshTime 5s
print("up 3 days")
`,
  "search.sh": `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Search Issues
# @raycast.mode silent
# @raycast.needsConfirmation true
# @raycast.argument1 { "type": "text", "placeholder": "Query", "percentEncoded": true }
# @raycast.argument2 { "type": "dropdown", "placeholder": "Repo", "data": [{"title": "Omarchy", "value": "basecamp/omarchy"}, {"title": "oma-cast", "value": "typecraft/oma-cast"}] }
# @raycast.argument3 { "type": "password", "placeholder": "Token", "optional": true }
echo "$1 $2"
`,
  "inline-no-refresh.sh": `#!/bin/bash
// @raycast.schemaVersion 1
// @raycast.title Inline Without Refresh
// @raycast.mode inline
echo x
`,
  "broken.sh": `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.mode compact
echo no title
`,
  "not-executable.sh": `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Nope
# @raycast.mode compact
`,
  "starter.template.sh": `#!/bin/bash\n# @raycast.title Template\n`,
  "empty.sh": ""
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oma-cast-scripts-"))
  for (const [name, body] of Object.entries(samples)) {
    fs.writeFileSync(path.join(dir, name), body)
    if (name !== "not-executable.sh") fs.chmodSync(path.join(dir, name), 0o755)
  }
  fs.mkdirSync(path.join(dir, "subdir"))
  return dir
}

test("the bash scan finds executables and says why it skipped the rest", () => {
  const dir = fixture()
  const output = execFileSync("bash", ["-c", SC.SCAN_SCRIPT, "scan", dir], { encoding: "utf8" })
  const { scripts, skipped } = SC.load(output)
  assert.deepEqual(scripts.map((s) => s.title), ["Hello World", "Inline Without Refresh", "Search Issues", "Uptime"])
  const reasons = Object.fromEntries(skipped.map((s) => [s.fileName, s.reason]))
  assert.deepEqual(reasons, {
    "broken.sh": "missing @raycast.title",
    "empty.sh": "empty file",
    "not-executable.sh": "not executable (chmod +x)",
    "starter.template.sh": "template"
  })
  fs.rmSync(dir, { recursive: true })
})

test("an empty or missing directory scans to nothing", () => {
  const output = execFileSync("bash", ["-c", SC.SCAN_SCRIPT, "scan", "/nonexistent/oma-cast"], { encoding: "utf8" })
  assert.deepEqual(SC.load(output), { scripts: [], skipped: [] })
})

test("headers: modes, packageName, refreshTime, arguments", () => {
  const hello = SC.parseScript("/s/script-commands/hello.sh", samples["hello.sh"])
  assert.equal(hello.id, "script:hello.sh")
  assert.equal(hello.mode, "fullOutput")
  assert.equal(hello.packageName, "Greetings")
  assert.equal(hello.cwd, "/s/script-commands")

  const uptime = SC.parseScript("/s/script-commands/weather.py", samples["weather.py"])
  assert.equal(uptime.mode, "inline")
  assert.equal(uptime.refreshSeconds, 10, "refreshTime is at least 10 s")
  assert.equal(uptime.packageName, "Script Commands", "defaults to the Title-Cased directory")

  const inline = SC.parseScript("/s/x/a.sh", samples["inline-no-refresh.sh"])
  assert.equal(inline.mode, "compact", "inline without refreshTime is compact; // comments work")

  const search = SC.parseScript("/s/x/search.sh", samples["search.sh"])
  assert.equal(search.needsConfirmation, true)
  assert.deepEqual(search.arguments.map((a) => [a.name, a.type, a.required]), [
    ["argument1", "text", true], ["argument2", "dropdown", true], ["argument3", "password", false]
  ])
  assert.deepEqual(search.arguments[1].data[1], { title: "oma-cast", value: "typecraft/oma-cast" })

  assert.equal(SC.parseRefresh("2m"), 120)
  assert.equal(SC.parseRefresh("10"), null)
  assert.throws(() => SC.parseScript("/a", "# @raycast.schemaVersion 2\n# @raycast.title X\n# @raycast.mode compact"), /schemaVersion must be 1/)
  assert.throws(() => SC.parseScript("/a", "# @raycast.schemaVersion 1\n# @raycast.title X\n# @raycast.mode loud"), /unknown mode/)
  assert.throws(() => SC.parseScript("/a", "# @raycast.schemaVersion 1\n# @raycast.title X\n# @raycast.mode compact\n# @raycast.argument1 {nope"), /argument1 is not JSON/)
})

test("argv: positional, percent-encoded, validated", () => {
  const search = SC.parseScript("/s/x/search.sh", samples["search.sh"])
  assert.deepEqual(SC.argv(search, { argument1: "a b&c", argument2: "basecamp/omarchy" }), ["/s/x/search.sh", "a%20b%26c", "basecamp/omarchy", ""])
  assert.throws(() => SC.argv(search, { argument2: "basecamp/omarchy" }), /Fill in Query/)
  assert.throws(() => SC.argv(search, { argument1: "x", argument2: "evil" }), /pick one of the options/)
})

test("candidates: icons, inline subtitle, searchable package name", () => {
  const hello = SC.candidate(SC.parseScript("/s/x/hello.sh", samples["hello.sh"]), "")
  assert.equal(hello.glyph, "👋")
  assert.equal(hello.subtitle, "Greetings")
  assert.equal(hello.typeLabel, "Script Command")
  const uptime = SC.parseScript("/s/x/weather.py", samples["weather.py"])
  assert.equal(SC.candidate(uptime, "up 3 days").subtitle, "up 3 days")
  assert.deepEqual(SC.iconFor({ icon: "images/logo.png", path: "/s/x/a.sh" }), { glyph: "", iconName: "/s/x/images/logo.png" })
  assert.deepEqual(SC.iconFor({ icon: "https://example.com/i.png", path: "/s/x/a.sh" }), { glyph: "", iconName: "" })
})

test("output lines drop ANSI colours and blank lines", () => {
  const out = "\x1b[32mstarting\x1b[0m\n\n  done: 3 files  \n\n"
  assert.equal(SC.firstLine(out), "starting")
  assert.equal(SC.lastLine(out), "done: 3 files")
  assert.equal(SC.lastLine(""), "")
})
