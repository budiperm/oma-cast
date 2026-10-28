const test = require("node:test")
const assert = require("node:assert/strict")
const DeepLink = require("../plugin/core/DeepLink.js")

test("run links carry the command id and its arguments", () => {
  assert.deepEqual(DeepLink.parse("oma-cast://run/script:hello.sh"), { route: "run", id: "script:hello.sh", arguments: {} })
  assert.deepEqual(DeepLink.parse("oma-cast://run/app%3Aorg.gnome.Nautilus/"), { route: "run", id: "app:org.gnome.Nautilus", arguments: {} })
  assert.deepEqual(DeepLink.parse("oma-cast://run/builtin:google-search?query=oma+cast%20%26%20more"),
    { route: "run", id: "builtin:google-search", arguments: { query: "oma cast & more" } })
  assert.deepEqual(DeepLink.parse("OMA-CAST://run/script:x.sh?argument1=a&argument2=&flag").arguments, { argument1: "a", argument2: "", flag: "" })
})

test("show and settings links", () => {
  assert.deepEqual(DeepLink.parse("oma-cast://show?query=2%2B2"), { route: "show", query: "2+2" })
  assert.deepEqual(DeepLink.parse("oma-cast://show"), { route: "show", query: "" })
  assert.deepEqual(DeepLink.parse("oma-cast://settings"), { route: "settings", page: "" })
  assert.deepEqual(DeepLink.parse("oma-cast://settings/Calculator"), { route: "settings", page: "calculator" })
})

test("bad links are rejected with a reason", () => {
  assert.throws(() => DeepLink.parse("raycast://extensions/x"), /Not an oma-cast/)
  assert.throws(() => DeepLink.parse("oma-cast://run/"), /needs a command id/)
  assert.throws(() => DeepLink.parse("oma-cast://settings/nope"), /No settings page/)
  assert.throws(() => DeepLink.parse("oma-cast://launch/x"), /Unknown oma-cast:\/\/ link: launch/)
  assert.throws(() => DeepLink.parse("oma-cast://run/%E0%A4%A"), /bad percent-encoding/)
})
