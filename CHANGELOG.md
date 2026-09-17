# Changelog

All notable changes to AgentBackend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The filesystem toolset is repositioned to target parity with Claude Code's
in-CLI file tools rather than the reference MCP Filesystem Server. See
[packages/agent-backend/opensdd/daemon.md](packages/agent-backend/opensdd/daemon.md)
for the updated contract.

### Added

- `RemoteFilesystemBackendConfig.secure` (TypeScript and Python): use TLS for
  both daemon channels — MCP over `https://` and SSH-over-WebSocket over
  `wss://`. When unset, TLS is used only on port 443.
- `RemoteFilesystemBackendConfig.headers` (TypeScript and Python): extra
  headers sent on every MCP request and on the SSH-over-WebSocket upgrade, for
  reaching a daemon behind a reverse proxy that routes on a header. They cannot
  override `Authorization`, `X-Root-Dir` or `X-Scope-Path`. Scoped backends
  send their root backend's headers. `createAgentBeMCPTransport` and
  `createAgentBeMCPClient` accept the same `headers` option.
- The `agentbe-daemon` image is also tagged with the bare package version
  (e.g. `0.13.2`), so the image can be pinned to the installed client version.
- **Agent document room** (`@agentbe/room`): a multiplayer, versioned,
  content-addressed document store with semantic + cross-modal (text/image)
  search and sandboxed command execution, exposed to agents over MCP
  (`search`, `read_document`, `run_command`, `open_session`/`write_file`/
  `commit_session`, `put_document`). See `docs/room-architecture.md` and
  `docs/room-deployment.md`.
- Per-principal commit attribution derived from the transport credential
  (never a caller-suppliable argument), with per-person bearer tokens via
  `AGENTBE_PRINCIPALS`.
- Docker and Kubernetes sandbox providers (`AGENTBE_SANDBOX=docker|k8s|agent-sandbox`),
  giving each session its own container or pod; `k8s` needs no extra install,
  `agent-sandbox` adds a warm pool for lower session start latency.
- S3-backed canonical store and a persistent pgvector-backed search index for
  production deployments.
- `grep` tool: content search backed by ripgrep. Registered for backends that
  support `exec` (i.e. not the memory backend). Parameters mirror Claude Code's
  Grep tool: `pattern`, `path`, `glob`, `type`, `outputMode`, `caseInsensitive`,
  `multiline`, `contextBefore`/`contextAfter`/`contextAround`, `lineNumbers`,
  `headLimit`. The three context parameters may be combined freely and resolve
  the way `rg` itself resolves them — an explicit `contextBefore`/`contextAfter`
  wins over `contextAround` for that side — and are ignored outside
  `outputMode: "content"` rather than rejected. Requires `rg` on the host; the
  `agentbe-daemon` Docker image already includes it.
- `edit_file` edits now accept an optional `replaceAll` per-edit flag for bulk
  renames.
- `search_files` accepts an optional `sortBy: "path" | "mtime"` parameter.
  `mtime` sorts results newest-first, matching Claude Code's Glob behavior.

### Fixed

- `RemoteFilesystemBackend.getMCPClient(scopePath)` ignored its scope and sent
  neither `X-Root-Dir` nor `X-Scope-Path`, so `backend.scope('a/b').getMCPClient()`
  operated on the daemon's root. It now uses the same transport as
  `getMCPTransport`. As a consequence it now also sends `X-Root-Dir`, so a
  client `rootDir` that doesn't match the daemon's is rejected with 403, as it
  already was through `getMCPTransport`/`VercelAIAdapter`. The Python
  `get_mcp_client` had the same shape of bug (it sent a scope-joined
  `X-Root-Dir`) and is fixed the same way.
- Python: the MCP channel ignored `port` and always used `mcp_port` (default
  3001), while SSH-over-WebSocket used `port`. Both channels now use
  `port or mcp_port`, matching TypeScript's single-port model.
- The default `start-docker` image pointed at the stale
  `ghcr.io/aspects-ai/agentbe-daemon:latest` (agent-backend 0.8.7, amd64 only,
  incompatible entrypoint). It is now `ghcr.io/deepagents-ai/agentbe-daemon:latest`.
- **Security:** commands run by the daemon (exec, SSH exec and shell sessions)
  inherited the daemon's environment, so `env` in the sandbox printed
  `AUTH_TOKEN`. The daemon now removes `AUTH_TOKEN` and `MCP_AUTH_TOKEN` from
  its environment at startup. Nothing in agent-backend reads either variable
  from a child process. A command that relied on `$AUTH_TOKEN` must now be
  given it explicitly (e.g. through a scope's `env`).
- **Security:** the daemon compared auth tokens with `===`, which can leak
  timing information. `/mcp` and `/ssh` now use constant-time comparison.
- `VercelAIAdapter.getMCPClient` errors for remote backends now name the MCP
  endpoint and HTTP status, and SSH-over-WebSocket connection errors name the
  WebSocket URL, instead of a bare "Error POSTing to endpoint".
- `edit_file` could hang the daemon indefinitely at 100% CPU. Its hand-rolled
  unified-diff renderer advanced its two cursors only inside a pair of 10-line
  lookahead scans, and when both scans declined to advance — which any adjacent
  transposition satisfies, and which repeated boilerplate lines in structured
  text trigger readily — the loop re-ran identically forever. Because rendering
  is synchronous, this blocked the daemon's only thread: every session it served
  went unresponsive, and the process stayed pinned after the caller
  disconnected. Diff rendering now delegates to the `diff` library, which
  terminates for all inputs and also fixes silently wrong hunks on larger
  reorderings.

### Changed

- **Remote MCP uses HTTPS on port 443.** With `secure` unset and `port: 443`,
  the MCP channel now connects over `https://` (it was always `http://`),
  matching the SSH-over-WebSocket channel, which already used `wss://` there.
  Set `secure: false` to keep plain HTTP on 443.
- **SSH-over-WebSocket token moved to a header.** The TypeScript client now
  sends the auth token as `Authorization: Bearer <token>` on the upgrade
  request instead of `?token=` in the URL, which proxies and access logs
  record. Every daemon from 0.13.1 on accepts the header; the daemon still
  accepts the query parameter so older clients keep connecting.
- `edit_file` diffs now carry standard `@@` hunk headers with 3 lines of
  context, and rendering is bounded by a budget enforced inside the diff loop
  (15 s wall clock, 20,000 line-level edits). On breach the tool returns the
  file headers plus a `[diff omitted: ...]` marker instead of blocking. The
  write is now performed before the diff is rendered, so a degraded or failed
  render can never discard an edit that has already been applied; in that case
  the result leads with a line confirming the edit landed.
- `read_text_file` now paginates by default (first 1,000 lines) and truncates
  lines longer than 2,000 chars. Use `offset` and `limit` to read further.
  Full-file reads without paging will see a trailing footer indicating more
  content is available. This is a minor-version breaking change for callers
  that relied on unparameterised full-file reads.
- `read_text_file` paging is now a single mode: `offset`/`limit`. The `head` and
  `tail` parameters are removed, and with only one mode left there is no
  mode-conflict error to throw. `head: N` was byte-identical to
  `offset: 1, limit: N`; `tail` is reachable via `exec` (`tail -n 100 <file>`).
  The `offset`/`limit` descriptions now say to supply them only if the file is
  too large to read at once, and no longer advertise the clamp ceiling.
  Rationale: the four-parameter surface encoded three mutually-exclusive modes,
  and models routinely filled every field and got an error on a read the tool
  had enough information to serve. Minor-version breaking for callers whose
  prompts explicitly instruct agents to use `head`/`tail`.
- `edit_file` now throws if an edit's `oldText` appears multiple times in the
  current file state and `replaceAll` is not set. Previously, only the first
  occurrence was silently replaced — which could edit the wrong instance. To
  preserve old behavior pass `replaceAll: true`, or add surrounding context to
  `oldText` to uniquely identify the intended match. Minor-version breaking.