// oma-cast:// deep links (SPEC §12 Phase 2 scope) [D]:
//
//   oma-cast://run/<commandId>?<argument>=<value>&…   run a command; one that
//                                                      asks first still asks
//   oma-cast://show?query=<text>                       open with a query
//   oma-cast://settings[/<page>]                        open the settings view
//
// Command ids contain ":" (script:hello.sh, app:firefox); they may be
// percent-encoded or not.

var SCHEME = "oma-cast://"
var PAGES = { general: true, commands: true, calculator: true, scripts: true }

function decode(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, " ")) } catch (e) { throw new Error("Malformed link: bad percent-encoding") }
}

function parseQuery(q) {
  var out = {}
  if (!q) return out
  var pairs = q.split("&")
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue
    var eq = pairs[i].indexOf("=")
    var key = decode(eq < 0 ? pairs[i] : pairs[i].slice(0, eq))
    out[key] = eq < 0 ? "" : decode(pairs[i].slice(eq + 1))
  }
  return out
}

function parse(url) {
  var u = String(url || "").trim()
  if (u.toLowerCase().indexOf(SCHEME) !== 0) throw new Error("Not an oma-cast:// link")
  var rest = u.slice(SCHEME.length).replace(/#.*$/, "")
  var q = rest.indexOf("?")
  var path = q < 0 ? rest : rest.slice(0, q)
  var params = parseQuery(q < 0 ? "" : rest.slice(q + 1))
  var slash = path.indexOf("/")
  var route = (slash < 0 ? path : path.slice(0, slash)).toLowerCase()
  var tail = slash < 0 ? "" : path.slice(slash + 1).replace(/\/+$/, "")

  switch (route) {
    case "run":
      var id = decode(tail)
      if (!id) throw new Error("oma-cast://run needs a command id")
      return { route: "run", id: id, arguments: params }
    case "show":
      return { route: "show", query: params.query || "" }
    case "settings":
      var page = decode(tail).toLowerCase()
      if (page && !PAGES[page]) throw new Error("No settings page " + page)
      return { route: "settings", page: page }
  }
  throw new Error("Unknown oma-cast:// link: " + (route || "(empty)"))
}

if (typeof module !== "undefined") module.exports = { SCHEME: SCHEME, parse: parse }
