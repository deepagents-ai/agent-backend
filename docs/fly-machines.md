# Fly.io Machines

Run one `agentbe-daemon` per Fly Machine and reach each one from the
application through Fly's public proxy with `RemoteFilesystemBackend`. Each
Machine is a Firecracker microVM, so every daemon (for example, one per user or
tenant) gets its own isolation boundary.

## Table of Contents

- [How it works](#how-it-works)
- [Deploy a daemon](#deploy-a-daemon)
- [Per-machine tokens](#per-machine-tokens)
- [Connect from the application](#connect-from-the-application)
- [Verify the deployment](#verify-the-deployment)
- [Operations](#operations)

## How it works

```text
application ──https/wss :443──▶ <app>.fly.dev (Fly proxy, TLS) ──http/ws :3001──▶ Machine <id>
            fly-force-instance-id: <id>
```

- One Fly app holds every daemon; each daemon is one Machine.
- The application can run anywhere. It does not need Fly's private network.
- Fly's proxy terminates TLS on port `443` and forwards HTTP and WebSocket traffic
  to the daemon on port `3001`.
- The proxy picks the Machine from the `fly-force-instance-id` request header.
  Both daemon channels, MCP at `/mcp` and SSH-over-WebSocket at `/ssh`, carry it.

Creating, starting, stopping, destroying, and routing to Machines is the
application's job. Agent Backend only needs a host, a token, and the routing
header.

## Deploy a daemon

Prerequisites: `flyctl` logged in to the target organization. Docker with
`buildx` is needed only when building the image from source.

1. Create the app and allocate public IPs so `<app>.fly.dev` resolves:

   ```bash
   fly apps create <app> --org <org>
   fly ips allocate-v4 --shared -a <app>
   fly ips allocate-v6 -a <app>
   ```

2. Choose an image. Use the published daemon image pinned to the
   `agent-backend` version the application installs from npm or PyPI:

   ```text
   ghcr.io/deepagents-ai/agentbe-daemon:<version>
   ```

   `secure` and `headers` need a client newer than 0.13.1, and bare version
   tags (`:0.13.2`) are published from that release on. Earlier releases are
   tagged `v<version>` only.

   <details>
   <summary>Build from a source checkout instead</summary>

   From the repository root:

   ```bash
   pnpm --filter=agent-backend build
   fly auth docker
   docker buildx build --platform linux/amd64 \
     -f agentbe-daemon/docker/Dockerfile \
     --build-arg AGENTBE_VERSION=local \
     -t registry.fly.io/<app>:<tag> --push .
   ```

   Build locally rather than with Fly's remote builder: the repository has no
   `.dockerignore`, and the root `node_modules` is about 2.5 GB.

   A push to `registry.fly.io` right after `fly apps create` can fail with
   `name unknown: app repository not found`. Retry after a few minutes.

   </details>

3. Start one Machine per daemon, each with its own token:

   ```bash
   fly machine run <image> -a <app> \
     --name <name> \
     --region <region> \
     --port 443:3001/tcp:tls:http \
     --vm-size shared-cpu-1x \
     --vm-memory 1024 \
     -e AUTH_TOKEN=<token> \
     --autostop=off
   ```

   The `tls:http` handlers make Fly terminate TLS and speak HTTP to the
   daemon; WebSocket upgrades pass through.

4. Record the Machine ID:

   ```bash
   fly machines list -a <app>
   ```

5. Check the health endpoint through the proxy:

   ```bash
   curl -H 'fly-force-instance-id: <machine-id>' https://<app>.fly.dev/health
   ```

   A healthy daemon returns `200` with `{"status":"ok",...}`.

## Per-machine tokens

Set `AUTH_TOKEN` in each Machine's own environment (`-e AUTH_TOKEN=...` or the
`env` field of the Machines API config). Do **not** use `fly secrets set`.

App secrets are shared by every Machine in the app. With a shared secret, every
daemon accepts every tenant's token, and `fly-force-instance-id` alone selects
any tenant's Machine. A distinct token per Machine makes the header a routing
hint, not an access grant.

Limits of this model:

- Machine environment is visible to members of the Fly organization through
  `fly machine status`.
- The daemon removes `AUTH_TOKEN` and `MCP_AUTH_TOKEN` from the environment of
  the commands it runs. The image runs as root, however, and passes the token on
  the daemon's command line, so a command inside the same Machine can still read
  it through `ps` or `/proc`. The microVM protects other Machines and the Fly
  host, not the token from workloads on its own Machine.

See [Security & Isolation](security.md) for the broader threat model.

## Connect from the application

Point the client at the app hostname on port `443` and add the routing header:

```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: '<app>.fly.dev',
  port: 443,
  secure: true,
  authToken: machineToken,
  headers: { 'fly-force-instance-id': machineId },
})

const userBackend = backend.scope('users/123')
await userBackend.write('hello.txt', 'Hello from Fly!')
console.log(await userBackend.exec('ls'))
await backend.destroy()
```

- `rootDir` must match the daemon's `WORKSPACE_ROOT` (default `/var/workspace`).
- Port `443` already selects `https` and `wss`; `secure: true` makes it explicit.
- `headers` is sent on every MCP request and on the WebSocket upgrade, including
  from scoped backends, `VercelAIAdapter`, and `getMCPClient`. It cannot
  override `Authorization`, `X-Root-Dir`, or `X-Scope-Path`.

See [Daemon URLs and TLS](../packages/agent-backend/opensdd/clients.md#daemon-urls-and-tls)
and [Extra Headers](../packages/agent-backend/opensdd/clients.md#extra-headers)
for the exact client contract.

<details>
<summary>Python equivalent</summary>

```python
from agent_backend import RemoteFilesystemBackend, RemoteFilesystemBackendConfig

backend = RemoteFilesystemBackend(RemoteFilesystemBackendConfig(
    root_dir="/var/workspace",
    host="<app>.fly.dev",
    port=443,
    secure=True,
    auth_token=machine_token,
    headers={"fly-force-instance-id": machine_id},
))

user_backend = backend.scope("users/123")
await user_backend.write("hello.txt", "Hello from Fly!")
await backend.destroy()
```

</details>

## Verify the deployment

[`tests/manual/verify-remote-daemons.ts`](../packages/agent-backend/typescript/tests/manual/verify-remote-daemons.ts)
exercises real daemons behind the proxy. Run it from
`packages/agent-backend/typescript` with two or more Machines:

```bash
AGENTBE_VERIFY_HOST=<app>.fly.dev \
AGENTBE_VERIFY_TARGETS='[
  {"name":"a","authToken":"<token-a>","headers":{"fly-force-instance-id":"<id-a>"}},
  {"name":"b","authToken":"<token-b>","headers":{"fly-force-instance-id":"<id-b>"}}
]' \
npx tsx tests/manual/verify-remote-daemons.ts
```

For each Machine, the script checks that:

- routing reaches the named Machine
- scoped `write`, `read`, `stat`, `readdir`, and `exec` work
- the token is absent from the `env` output of commands
- MCP tools work through `VercelAIAdapter`
- a scoped `getMCPClient` `list_directory` shows only the scope
- a wrong token is refused on SSH-over-WebSocket (`AUTH_FAILED`) and MCP (HTTP `401`)

It then checks cross-machine isolation (a file written through A is absent
through B) and removes what it created. `AGENTBE_VERIFY_PORT` (default `443`)
and `AGENTBE_VERIFY_ROOT` (default `/var/workspace`) are optional.

## Operations

- **Auth failures are slow.** Through Fly's proxy, SSH-over-WebSocket takes
  about 5 seconds to reject a wrong token (milliseconds locally). It still fails
  with `AUTH_FAILED`.
- **Autostop.** The steps above use `--autostop=off`. With autostop enabled, the
  first request after a Machine stops pays a cold start.
- **Workspace persistence.** The workspace lives on the Machine's root
  filesystem and is lost when the Machine is destroyed or replaced. To keep it,
  attach a Fly volume at the workspace root with
  `--volume <volume>:/var/workspace`. This configuration has not been tested.
- **Cleanup.** Destroy a Machine with:

  ```bash
  fly machine destroy --force <machine-id> -a <app>
  ```
