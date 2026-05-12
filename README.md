# gst-graph

A desktop visual editor for GStreamer pipelines. Drag elements from a
plugin-aware palette, wire them together with caps-validated stream
links, bind variables and computed transforms to element properties,
and run the resulting `gst-launch-1.0` pipeline directly from the app.

Includes an MCP (Model Context Protocol) server so a local LLM agent
can read, edit, and run pipelines on your machine using the same data
files the UI uses, with live two-way sync.

## Features

- **Plugin-aware palette.** The app shells out to `gst-inspect-1.0` on
  first run, parses every element on your system (properties, pad
  templates, caps, conditional properties, enums, ranges) and caches
  the result on disk. Search by name, longname, or description.
- **Caps-validated stream links.** Dragging from a source pad to a
  sink pad refuses to connect when the caps are incompatible.
- **Property editors per kind.** Booleans, enums, ranges, fractions,
  strings, integers — each gets the right widget with default value,
  blurb, and visibility based on conditional requirements (e.g. an
  RTMP element's `tcUrl` only appears when `auth-method` requires it).
- **Multiple pipelines.** Home screen lists every saved pipeline as a
  tile with a status pill, exposed variables, and Start / Stop /
  Configure / Export / Delete actions. Each tile becomes its own
  editor when opened.
- **Variables.** Add a `string` / `number` / `boolean` variable, wire
  its output handle to any element property, and the property's value
  is overridden at runtime. The variable's kind is auto-inferred from
  the property it is first bound to. Human labels are shown on the
  Home tile next to the editable value.
- **Internal constants.** Toggle a variable to `hidden` and it
  disappears from the Home screen but keeps driving the bound
  properties — useful for things you want to bake in but not expose to
  end users.
- **Transforms.**
  - `Concat`: template-style string concatenation with `${name}`
    placeholders (good for URLs, file paths, etc.)
  - `Math`: sandboxed arithmetic expressions over named inputs, with
    `Math.*` available (`a * 1000`, `Math.min(a, b)`, ...).
  - Live `=` preview shows the resolved value as you type. Transforms
    can feed into other transforms, with cycle detection.
- **Persistence under `~/.gst-graph/`.**
  - `pipelines.json` — every change is autosaved (atomic temp+rename
    write with a `.bak` rotation kept around for one-revision
    rollback).
  - `plugin-cache.json` — element catalog, refreshed when the
    GStreamer version changes.
  - `runs.json` — cross-process registry of running pipelines.
  - `mcp-http.json` — port info for the embedded MCP HTTP server when
    the app is running.
  - All writes are atomic, persistence is gated on a successful load
    (a corrupt file won't be overwritten by an empty in-memory state),
    and pending writes are flushed on quit.
- **Importable / exportable JSON.** Pipelines can be exported as JSON
  from the Home tile or the editor toolbar, and reimported in any
  install (multi-file picker supported).
- **MCP server (stdio + HTTP).** Drive the app from any
  MCP-compatible LLM client. 22 tools covering discovery, full graph
  editing, transforms, variables, and runtime control. The Electron UI
  watches the data files and reloads live when the agent makes
  changes.

## Requirements

- macOS, Linux, or Windows
- [GStreamer 1.x](https://gstreamer.freedesktop.org/) with
  `gst-inspect-1.0` and `gst-launch-1.0` on `PATH`. Verify with
  `gst-inspect-1.0 --gst-version`.
- Node.js 20+ (24+ recommended)
- npm 10+

### Installing GStreamer

- **macOS (Homebrew):** `brew install gstreamer gst-plugins-base
  gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav`
- **Debian / Ubuntu:** `sudo apt install gstreamer1.0-tools
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly
  gstreamer1.0-libav`
- **Windows:** install the official GStreamer development +
  runtime MSIs from gstreamer.freedesktop.org and add the `bin/`
  directory to `PATH`.

## Installation

```sh
git clone <this-repository-url> gst-graph
cd gst-graph
npm install
```

## Running in development

```sh
npm run dev
```

This starts three concurrent processes:

- Vite dev server (renderer) on `http://localhost:5173`
- TypeScript compiler in watch mode for the Electron main and
  preload scripts
- Electron, pointed at the dev server with hot reload

If you change a file under `electron/` or `mcp/` while Electron is
already running, the build is recompiled but the running process is
**not** automatically restarted — quit Electron with ⌘Q and re-run
`npm run dev` to pick up main-process changes.

## Building a production bundle

```sh
npm run build
npm start
```

`npm run build` produces `dist/` (renderer bundle) and
`dist-electron/` (compiled main, preload, and MCP server). `npm
start` launches Electron against the built bundle.

## Using the editor

### 1. Create a pipeline

On the Home screen click `+ New Pipeline`, give it a name, and the
editor opens.

### 2. Add elements

The left palette lists every element discovered by `gst-inspect-1.0`.
Type in the search box to filter. Drag elements onto the canvas.

### 3. Wire elements together

Drag from a source pad handle (right side of a node) to a sink pad
handle (left side of another node). The drag preview rejects
incompatible caps before you release.

### 4. Edit properties

Click a node to open the right-hand inspector. Properties are grouped
by category, with conditional properties hidden until their
requirements are met. Use the search box at the top of the inspector
to jump to a specific property.

### 5. Add variables (optional)

Click `+ Variable` in the toolbar. Drag from the variable's `out`
handle to any element property. The variable's value (settable from
the Home tile or the inspector) overrides the static property at
runtime. Use the `shown` / `hidden` chip on the variable node to flip
it between a Home-screen-exposed variable and an internal constant.

### 6. Add transforms (optional)

Click `+ Concat` or `+ Math` in the toolbar. Each transform has
named input slots, an editable expression / template, and a live `=`
preview of the resolved value. Wire variables (or other transforms)
into the input slots, then wire the transform's output to an element
property.

Examples:

- `Concat` template `rtmp://${host}/live/${streamKey}` with `host`
  and `streamKey` variables → produces a fully composed URL bound to
  an `rtmpsink`'s `location`.
- `Math` expression `kbps * 1000` with `kbps` variable → bound to
  `num-buffers` or any bitrate property.

### 7. Run

Click `▶ Start` in the toolbar (or on the Home tile). The pipeline is
spawned as `gst-launch-1.0 -e -v <command>` and its output streams
into the bottom console. Click `■ Stop` to send SIGINT.

### 8. Export / Import

`↓ Export` from the toolbar or a Home tile saves the pipeline as JSON
(no GStreamer-specific tokenization — just the graph). `↑ Import`
accepts one or more JSON files and adds them with name de-duplication.

## File layout

All state lives under `~/.gst-graph/`:

```
~/.gst-graph/
├── pipelines.json       # your saved pipelines (atomic writes + .bak rotation)
├── pipelines.json.bak   # previous revision, kept for recovery
├── plugin-cache.json    # cached gst-inspect output (refreshed on version change)
├── runs.json            # PIDs and metadata of currently-running pipelines
└── mcp-http.json        # MCP HTTP server URL and port (only while Electron is running)
```

The data directory and version are visible in the Home meta line, along
with an `autosave on` / `autosave OFF` indicator. If autosave goes OFF
(unreadable `pipelines.json`), the file is left alone instead of being
overwritten with an empty state — back it up from `.bak` if needed and
then restart the app.

## MCP integration

`mcp/README.md` covers the full tool catalog and client configuration
in depth. Quick start:

### Build

```sh
npm run mcp:build
```

This produces `dist-electron/mcp/stdio.js` (and is included in the
regular `npm run build`).

### Configure your client

The server speaks the standard Model Context Protocol over stdio (for
subprocess-style clients) and over HTTP/SSE (embedded in Electron when
the app is running, port discoverable in `~/.gst-graph/mcp-http.json`).

For Claude Desktop, edit
`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS and add:

```json
{
  "mcpServers": {
    "gst-graph": {
      "command": "node",
      "args": ["/absolute/path/to/gst-graph/dist-electron/mcp/stdio.js"]
    }
  }
}
```

For the Factory droid CLI:

```sh
droid mcp add gst-graph node /absolute/path/to/gst-graph/dist-electron/mcp/stdio.js --type stdio
```

Restart your MCP client. You should see 22 `gst_*` tools available.

### Verify

```sh
npm run mcp:smoke        # exercises stdio transport end-to-end
npm run mcp:smoke:http   # boots HTTP transport and hits /healthz + /sse
```

### Live sync

When the MCP server writes to `pipelines.json` (atomic with `.bak`
rotation), the running Electron app picks up the change within a
debounce window and reloads, preserving the active selection and
console log buffer. Runs are tracked in `runs.json`, so a pipeline
started by the agent can be stopped from the UI and vice versa.

## Available scripts

| Script               | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Renderer + main TS watcher + Electron with hot reload  |
| `npm run build`      | Production renderer bundle plus compiled main / MCP    |
| `npm start`          | Run the built Electron app                             |
| `npm run typecheck`  | TypeScript noEmit for both projects                    |
| `npm run lint`       | ESLint                                                 |
| `npm run mcp`        | Run the MCP server on stdio                            |
| `npm run mcp:build`  | Compile only the MCP/Electron Node side                |
| `npm run mcp:smoke`  | Spawn the stdio MCP server and run an integration test |
| `npm run mcp:smoke:http` | Boot the HTTP MCP server and check it                |

## Architecture

```
┌──────────────────────────┐      ┌─────────────────────────────┐
│       Electron Main      │      │       MCP Server (stdio)    │
│  - IPC handlers          │      │  - Same tool catalog        │
│  - gst-inspect cache     │◀────▶│  - Spawned by Claude /      │
│  - Runner (gst-launch)   │      │    Cursor / Factory         │
│  - File watch + autosave │      │  - Reads/writes same files  │
│  - HTTP MCP server (SSE) │      └─────────────────────────────┘
└──────────────────────────┘                  │
              │                               │
              │ IPC                           │ atomic file writes
              │                               │
              ▼                               ▼
┌──────────────────────────┐      ┌─────────────────────────────┐
│   React renderer (Vite)  │      │     ~/.gst-graph/           │
│  - xyflow graph editor   │◀────▶│   pipelines.json + .bak     │
│  - Zustand store         │      │   plugin-cache.json         │
│  - HomeScreen / Inspector│      │   runs.json                 │
│  - Live reload on extern │      │   mcp-http.json             │
└──────────────────────────┘      └─────────────────────────────┘
```

The Electron main process and the standalone MCP stdio server both
operate against the same files in `~/.gst-graph/`. Atomic writes plus
file-watching in the main process provide live two-way sync. The
runner registry (`runs.json`) plus the Electron runner's
`process.kill` fallback let the UI stop pipelines started by the MCP
server and vice versa.

## Project layout

```
gst-graph/
├── electron/                 # Electron main and preload
│   ├── main.ts               # IPC, persistence, file watcher, HTTP MCP server
│   ├── preload.ts            # contextBridge surface
│   └── gst/
│       ├── inspect.ts        # gst-inspect-1.0 parser, plugin cache
│       └── runner.ts         # builds gst-launch argv, spawns process
├── mcp/                      # MCP server (stdio + HTTP)
│   ├── data.ts               # ~/.gst-graph/ persistence helpers
│   ├── builder.ts            # pure pipeline mutation helpers
│   ├── runner.ts             # MCP-side gst-launch runner
│   ├── tools.ts              # 22 tool definitions
│   ├── stdio.ts              # stdio entrypoint (npm run mcp)
│   ├── http.ts               # HTTP/SSE transport
│   └── README.md             # MCP tool catalog and client config
├── shared/
│   └── types.ts              # shared TypeScript types
├── src/                      # React renderer
│   ├── components/           # ElementNode, VariableNode, TransformNode,
│   │                         # HomeScreen, PropertiesPanel, Toolbar, etc.
│   ├── state/store.ts        # Zustand store, autosave, hydrate, reload
│   └── lib/                  # caps compatibility, etc.
├── scripts/                  # smoke tests (gst-launch + MCP)
├── package.json
└── LICENSE
```

## License

Released under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

You may use, modify, and redistribute this software freely for any
noncommercial purpose — personal projects, research, hobby use,
education, charity, government, public-research organizations, etc.
**Commercial use is not permitted under this license.** If you need
a commercial license, open an issue.

This project depends on GStreamer, which is licensed separately under
the LGPL with various plugin-specific licenses; see the GStreamer
project for terms.
