import QtQuick
import Quickshell
import Quickshell.Io
import "../core/ScriptCommands.js" as ScriptCommands

// Scans the script-commands directory, runs scripts and keeps inline
// scripts' first output line (SPEC §9.9).
Item {
  id: source

  property string dir: ""
  property var scripts: []
  property var skipped: []
  property var byId: ({})
  property int revision: 0
  readonly property bool scanning: scanProc.running

  // Inline scripts: id -> {text, at (ms), error}
  property var inline: ({})
  property var inlineRunning: ({})

  // Live runs: runId -> {scriptId, mode, output, done, exitCode}
  property var runs: ({})
  property int runSerial: 0
  // runId -> Process, mutated in place (not a binding source).
  property var procs: ({})
  property string skippedKey: ""

  signal message(string level, string text, var metadata)
  signal runUpdated(string runId)
  signal runFinished(string runId)

  function refresh() {
    if (!source.dir || scanProc.running) return
    scanProc.command = ["bash", "-c", ScriptCommands.SCAN_SCRIPT, "oma-cast-scan", source.dir]
    scanProc.running = true
  }

  function script(id) { return source.byId[id] || null }

  // Re-run inline scripts whose output is older than their refreshTime.
  function refreshInline(nowMs) {
    for (var i = 0; i < source.scripts.length; i++) {
      var s = source.scripts[i]
      if (s.mode !== "inline" || source.inlineRunning[s.id]) continue
      var last = source.inline[s.id]
      if (last && nowMs - last.at < s.refreshSeconds * 1000) continue
      source.start(s, [s.path], true)
    }
  }

  // Starts a script with argv (ScriptCommands.argv). Returns the run id.
  function start(s, argv, inlineRun) {
    var runId = "run-" + (++source.runSerial)
    var proc = runComponent.createObject(source, { runId: runId, scriptId: s.id, inlineRun: !!inlineRun })
    source.procs[runId] = proc
    proc.workingDirectory = s.cwd
    proc.command = argv
    if (inlineRun) {
      var busy = Object.assign({}, source.inlineRunning); busy[s.id] = true; source.inlineRunning = busy
    } else {
      var next = Object.assign({}, source.runs)
      next[runId] = { scriptId: s.id, title: s.title, mode: s.mode, output: "", done: false, exitCode: null }
      source.runs = next
    }
    proc.running = true
    return runId
  }

  function stop(runId) {
    var proc = source.procs[runId]
    if (proc && proc.running) proc.signal(15)
  }

  function forget(runId) {
    var next = Object.assign({}, source.runs)
    delete next[runId]
    source.runs = next
  }

  function append(proc, line) {
    if (proc.inlineRun) { proc.collected += line + "\n"; return }
    var run = source.runs[proc.runId]
    if (!run) return
    var next = Object.assign({}, source.runs)
    next[proc.runId] = Object.assign({}, run, { output: run.output + line + "\n" })
    source.runs = next
    source.runUpdated(proc.runId)
  }

  function finish(proc, exitCode) {
    if (proc.inlineRun) {
      var line = ScriptCommands.firstLine(proc.collected)
      var inl = Object.assign({}, source.inline)
      inl[proc.scriptId] = exitCode === 0
        ? { text: line, at: Date.now(), error: false }
        : { text: "⚠️ Error: " + (ScriptCommands.lastLine(proc.collected) || "exit code " + exitCode), at: Date.now(), error: true }
      source.inline = inl
      var busy = Object.assign({}, source.inlineRunning); delete busy[proc.scriptId]; source.inlineRunning = busy
      source.revision++
    } else if (source.runs[proc.runId]) {
      var next = Object.assign({}, source.runs)
      next[proc.runId] = Object.assign({}, source.runs[proc.runId], { done: true, exitCode: exitCode })
      source.runs = next
      source.runFinished(proc.runId)
    }
    delete source.procs[proc.runId]
    proc.destroy()
  }

  Component {
    id: runComponent
    Process {
      id: proc
      property string runId: ""
      property string scriptId: ""
      property bool inlineRun: false
      property string collected: ""
      stdout: SplitParser { onRead: function(line) { source.append(proc, line) } }
      stderr: SplitParser { onRead: function(line) { source.append(proc, line) } }
      onExited: function(exitCode, exitStatus) { source.finish(proc, exitCode) }
    }
  }

  Process {
    id: scanProc
    stdout: StdioCollector {
      onStreamFinished: {
        var loaded = ScriptCommands.load(text)
        var byId = ({})
        for (var i = 0; i < loaded.scripts.length; i++) byId[loaded.scripts[i].id] = loaded.scripts[i]
        source.scripts = loaded.scripts
        source.skipped = loaded.skipped
        source.byId = byId
        var key = JSON.stringify(loaded.skipped)
        if (key !== source.skippedKey) {
          source.skippedKey = key
          for (var j = 0; j < loaded.skipped.length; j++)
            if (loaded.skipped[j].reason !== "template") source.message("info", "skipped script " + loaded.skipped[j].fileName + ": " + loaded.skipped[j].reason, null)
        }
        source.revision++
        source.refreshInline(Date.now())
      }
    }
  }
}
