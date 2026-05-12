# gst-graph MCP server

Control the gst-graph pipeline editor from any MCP-compatible LLM agent
(Claude Desktop, Cursor, Factory, etc.).

The server reads and writes the same files Electron uses under `~/.gst-graph/`,
so changes made by the agent appear live in the running Electron app (the UI
watches `pipelines.json` and reloads on external writes). Conversely, runs
started in either process are tracked in `~/.gst-graph/runs.json` so the
opposite side can stop them.

## Build

```sh
npm install
npm run mcp:build
```

This produces `dist-electron/mcp/stdio.js` (stdio transport) and `dist-electron/mcp/http.js`.

## Smoke tests

```sh
npm run mcp:smoke         # spawns the stdio server and exercises core tools
npm run mcp:smoke:http    # starts the HTTP/SSE server and hits /healthz + /sse
```

## Stdio transport

Most MCP clients launch the server as a subprocess over stdio.

### Claude Desktop / `.mcp.json`

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

### Factory droid

```sh
droid mcp add gst-graph node /absolute/path/to/gst-graph/dist-electron/mcp/stdio.js --type stdio
```

## HTTP / SSE transport

Electron embeds the same MCP server over HTTP. On startup it binds to
`127.0.0.1` on a random free port and writes connection info to
`~/.gst-graph/mcp-http.json`:

```json
{
  "url": "http://127.0.0.1:60093/sse",
  "port": 60093,
  "pid": 12345,
  "startedAt": 1778578940568
}
```

Health check: `GET http://127.0.0.1:<port>/healthz` returns
`{ "ok": true, "sessions": N }`.

### Connecting an MCP client

```json
{
  "mcpServers": {
    "gst-graph-http": {
      "url": "http://127.0.0.1:60093/sse"
    }
  }
}
```

(Replace the port with whatever is in `~/.gst-graph/mcp-http.json`.)

## Available tools

| Tool                              | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `gst_version`                     | Detected GStreamer toolchain version                                         |
| `gst_list_elements`               | Filterable element catalog                                                   |
| `gst_inspect_element`             | Properties, pad templates, caps, hierarchy                                   |
| `gst_list_pipelines`              | Summary of saved pipelines                                                   |
| `gst_get_pipeline`                | Full JSON for a single pipeline                                              |
| `gst_get_command`                 | Build the `gst-launch-1.0` command (with substitutions)                      |
| `gst_create_pipeline`             | New empty pipeline                                                           |
| `gst_delete_pipeline`             | Delete                                                                       |
| `gst_rename_pipeline`             | Rename                                                                      |
| `gst_import_pipeline`             | Import from JSON string                                                      |
| `gst_add_element`                 | Add a GStreamer element node                                                 |
| `gst_set_property`                | Set an element property                                                      |
| `gst_link_elements`               | Stream-link two elements                                                     |
| `gst_remove_node`                 | Remove a node and its edges                                                  |
| `gst_remove_edge`                 | Remove a single edge                                                         |
| `gst_add_variable`                | Add a variable (`string` / `number` / `boolean`; `hidden` for constants)     |
| `gst_set_variable`                | Set a variable's value                                                       |
| `gst_add_transform`               | Add a `concat` or `math` transform                                           |
| `gst_set_transform_expression`    | Change a transform's template/expression                                     |
| `gst_wire_transform_input`        | Wire a variable or transform output into a transform input slot              |
| `gst_bind_value`                  | Bind a variable or transform output to an element property                   |
| `gst_run_pipeline`                | Launch via `gst-launch-1.0`, returns PID                                     |
| `gst_stop_pipeline`               | SIGINT a running pipeline (works across mcp / electron sources)              |
| `gst_get_run_status`              | Running pipelines with recent log lines                                      |

## Live sync

- Electron's main process watches `~/.gst-graph/pipelines.json`. When MCP
  writes (atomic temp+rename plus `.bak` rotation), the renderer receives a
  `gst:pipelinesChanged` event and re-reads, preserving the active pipeline
  selection and any in-memory log buffers.
- The renderer's autosave is suspended for 1s after an external change to
  prevent a save loop.
- `~/.gst-graph/runs.json` is the cross-process run registry. MCP-started
  runs surface in the UI's status display; UI-started runs can be stopped
  via `gst_stop_pipeline`.
