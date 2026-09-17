# Agent Backend Setup Guide

Choose a setup based on where the filesystem and command execution should run.
The application uses `LocalFilesystemBackend` when execution stays in the same
process. Docker, remote-machine, and Kubernetes setups run `agentbe-daemon`
across an isolation boundary and use `RemoteFilesystemBackend`.

## Table of Contents

- [Choose a setup](#choose-a-setup)
- [Local in-process backend](#local-in-process-backend)
- [Local Docker daemon](#local-docker-daemon)
- [Remote machine](#remote-machine)
- [Kubernetes](#kubernetes)
- [Fly.io Machines](fly-machines.md)
- [Core daemon vs. Agent Document Room](#core-daemon-vs-agent-document-room)

## Choose a setup

| Setup | Client | Isolation boundary | Use it for |
|---|---|---|---|
| Local, `software` | `LocalFilesystemBackend` | None. Programmatic path validation and command checks only. | Trusted local development |
| Local, `bwrap` | `LocalFilesystemBackend` | Linux namespaces around each command | Local Linux development with OS-level isolation |
| Local Docker | `RemoteFilesystemBackend` | One Docker container around the daemon | Reproducible local isolation |
| Remote machine | `RemoteFilesystemBackend` | A dedicated VM | Workspaces on another machine |
| Kubernetes | `RemoteFilesystemBackend` | One pod around the daemon | A daemon and workspace inside a cluster |
| Fly.io Machines | `RemoteFilesystemBackend` | One Firecracker microVM per daemon | One daemon per user or tenant, reached through Fly's TLS proxy |

`rootDir` limits filesystem API paths, but it does not create a security boundary
for shell commands. Choose Bubblewrap, Docker, a dedicated VM, or a Kubernetes pod
when commands are not trusted.

For one daemon per Fly Machine, reached through Fly's public proxy with a
routing header, see [Fly.io Machines](fly-machines.md).

## Local in-process backend

Run `LocalFilesystemBackend` in the application process for the shortest local
setup. Select the isolation mode explicitly so the security behavior is clear.

Prerequisite: Node.js 18 or later. The Python example requires Python 3.11 or
later.

### Programmatic (software) validation

Install the package:

```bash
npm install agent-backend
mkdir -p ./workspace
```

Create `local-backend.mjs`:

```javascript
import { LocalFilesystemBackend } from 'agent-backend'

const backend = new LocalFilesystemBackend({
  rootDir: './workspace',
  isolation: 'software',
})

await backend.write('hello.txt', 'Hello from Agent Backend!')
console.log(await backend.exec('pwd'))
await backend.destroy()
```

Run it:

```bash
node local-backend.mjs
```

`software` mode keeps file operations inside `rootDir` and applies the
`preventDangerous` command sanity check by default. It is **not a security
sandbox**: commands run directly on the host with the application's permissions.
Use it only for trusted commands or when the whole process already runs inside
an isolation boundary.

### Bubblewrap isolation

Bubblewrap is available on Linux. Install it on Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install bubblewrap
```

Then require it in the backend configuration:

```javascript
const backend = new LocalFilesystemBackend({
  rootDir: './workspace',
  isolation: 'bwrap',
})
```

The constructor fails if `bwrap` is not installed. Each command receives Linux
namespace isolation, a writable bind mount for `rootDir`, read-only system
directories, and private `/tmp`, `/dev`, and `/proc` mounts. Bubblewrap is
started with `--share-net`, so commands still share the host network namespace.
Apply separate network controls when untrusted commands must not reach the host
network or external services.

Use `isolation: 'auto'` to select Bubblewrap when `bwrap` is installed and fall
back to `software` otherwise. Do not use `auto` when a real sandbox is mandatory,
because the fallback is not a security boundary.

<details>
<summary>Python equivalent</summary>

```bash
pip install agent-backend
mkdir -p ./workspace
```

```python
import asyncio

from agent_backend import (
    IsolationMode,
    LocalFilesystemBackend,
    LocalFilesystemBackendConfig,
)


async def main():
    backend = LocalFilesystemBackend(LocalFilesystemBackendConfig(
        root_dir="./workspace",
        isolation=IsolationMode.BWRAP,
    ))
    await backend.write("hello.txt", "Hello from Agent Backend!")
    print(await backend.exec("pwd"))
    await backend.destroy()


asyncio.run(main())
```

Set `isolation=IsolationMode.SOFTWARE` for software validation instead.

</details>

## Local Docker daemon

Run the daemon in a local container when the application should not execute
commands directly on the host.

Prerequisites: Docker and Node.js 18 or later.

1. Install the CLI and start the daemon with a persistent workspace:

   ```bash
   npm install -g agent-backend
   export AGENTBE_TOKEN="replace-with-a-long-random-token"

   agent-backend start-docker \
     --workspace ./workspace \
     --auth-token "$AGENTBE_TOKEN"
   ```

   The launcher publishes the daemon at `127.0.0.1:3001` and mounts the host's
   `./workspace` directory at `/var/workspace` inside the container.

   The published image is currently amd64-only. On an arm64 host, the launcher
   detects the missing architecture and retries with `linux/amd64` emulation,
   which is slower than a native image.

2. Verify the health endpoint:

   ```bash
   curl http://127.0.0.1:3001/health
   ```

3. Connect from the application:

   ```javascript
   import { RemoteFilesystemBackend } from 'agent-backend'

   const backend = new RemoteFilesystemBackend({
     rootDir: '/var/workspace',
     host: 'localhost',
     port: 3001,
     authToken: process.env.AGENTBE_TOKEN,
   })

   await backend.connect()
   await backend.write('hello.txt', 'Hello from Docker!')
   await backend.destroy()
   ```

   Use the container path `/var/workspace` as `rootDir`, not the host path.

4. Stop and remove the container:

   ```bash
   agent-backend stop-docker
   ```

Files remain in `./workspace`. See the
[daemon Docker reference](../agentbe-daemon/README.md#docker-configuration) for
custom images, environment files, and init scripts.

## Remote machine

Run the daemon directly on a dedicated machine when the VM is the isolation
boundary. The example keeps port `3001` on a private network; the daemon serves
HTTP and WebSocket traffic without built-in TLS.

1. On a Linux VM, install Node.js 18 or later and the CLI. Create a workspace
   owned by the unprivileged account that will run the daemon:

   ```bash
   npm install -g agent-backend
   sudo install -d -o "$USER" -g "$(id -gn)" /var/workspace
   ```

2. Start the daemon as that unprivileged account:

   ```bash
   export AGENTBE_TOKEN="replace-with-a-long-random-token"

   agent-backend daemon \
     --rootDir /var/workspace \
     --port 3001 \
     --auth-token "$AGENTBE_TOKEN" \
     --isolation software
   ```

   The default transport serves MCP and SSH-over-WebSocket on the same port.
   Root privileges are needed only for the optional conventional SSH mode, not
   for the default SSH-over-WebSocket mode.

   In this topology, the VM is the security boundary. `RemoteFilesystemBackend`
   file and command operations use SSH-over-WebSocket, so do not treat
   `--isolation software`, `rootDir`, or the daemon's command checks as a sandbox.

3. Restrict inbound port `3001` to the application host or private network.
   Do not expose the daemon directly to the public internet: the token protects
   access but is sent over unencrypted HTTP/WebSocket transport.

4. From the application, connect to the VM's private DNS name or address:

   ```javascript
   import { RemoteFilesystemBackend } from 'agent-backend'

   const backend = new RemoteFilesystemBackend({
     rootDir: '/var/workspace',
     host: 'agentbe.internal.example',
     port: 3001,
     authToken: process.env.AGENTBE_TOKEN,
   })

   await backend.connect()
   await backend.write('hello.txt', 'Hello from the VM!')
   await backend.destroy()
   ```

For a machine without a private network path, keep port `3001` firewalled and
forward it over SSH:

```bash
ssh -N -L 3001:127.0.0.1:3001 user@agentbe.example.com
```

Then use `host: 'localhost'` and `port: 3001` in the client. Run the daemon as a
dedicated account under a process supervisor for a long-lived deployment. The
[daemon deployment reference](../agentbe-daemon/README.md#cloud-deployment) also
shows a Docker-based VM deployment.

To reach the daemon across the internet instead, put a TLS-terminating reverse
proxy in front of it that forwards `/mcp` and the `/ssh` WebSocket to port
`3001`. Connect to the proxy on port `443`, which selects `https` and `wss`
(set `secure` explicitly for TLS on another port). Add `headers` when the proxy
routes on a request header; they are sent on every MCP request and on the
WebSocket upgrade:

```javascript
const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'agentbe.example.com',
  port: 443,
  authToken: process.env.AGENTBE_TOKEN,
  headers: { 'x-route-instance': process.env.AGENTBE_INSTANCE_ID },
})
```

## Kubernetes

Deploy one core daemon and one workspace volume when an application in the
cluster needs a shared Agent Backend. This topology creates a single daemon; it
does not create a pod per agent session.

Prerequisites: a cluster, `kubectl`, a default `StorageClass`, and an application
that can reach a cluster `Service`.

1. Create the authentication secret:

   ```bash
   export AGENTBE_TOKEN="replace-with-a-long-random-token"
   kubectl create secret generic agentbe-daemon \
     --from-literal=auth-token="$AGENTBE_TOKEN"
   ```

2. Save this manifest as `agentbe-daemon.yaml`:

   ```yaml
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: agentbe-workspace
   spec:
     accessModes:
       - ReadWriteOnce
     resources:
       requests:
         storage: 10Gi
   ---
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: agentbe-daemon
   spec:
     replicas: 1
     strategy:
       type: Recreate
     selector:
       matchLabels:
         app: agentbe-daemon
     template:
       metadata:
         labels:
           app: agentbe-daemon
       spec:
         nodeSelector:
           kubernetes.io/arch: amd64
         containers:
           - name: daemon
             image: ghcr.io/deepagents-ai/agentbe-daemon:latest
             ports:
               - name: agentbe
                 containerPort: 3001
             env:
               - name: WORKSPACE_ROOT
                 value: /var/workspace
               - name: AUTH_TOKEN
                 valueFrom:
                   secretKeyRef:
                     name: agentbe-daemon
                     key: auth-token
             readinessProbe:
               httpGet:
                 path: /health
                 port: agentbe
             livenessProbe:
               httpGet:
                 path: /health
                 port: agentbe
             volumeMounts:
               - name: workspace
                 mountPath: /var/workspace
         volumes:
           - name: workspace
             persistentVolumeClaim:
               claimName: agentbe-workspace
   ---
   apiVersion: v1
   kind: Service
   metadata:
     name: agentbe-daemon
   spec:
     selector:
       app: agentbe-daemon
     ports:
       - name: agentbe
         port: 3001
         targetPort: agentbe
   ```

3. Apply it and wait for the rollout:

   ```bash
   kubectl apply -f agentbe-daemon.yaml
   kubectl rollout status deployment/agentbe-daemon
   ```

4. Connect from an application in the same namespace:

   ```javascript
   import { RemoteFilesystemBackend } from 'agent-backend'

   const backend = new RemoteFilesystemBackend({
     rootDir: '/var/workspace',
     host: 'agentbe-daemon',
     port: 3001,
     authToken: process.env.AGENTBE_TOKEN,
   })

   await backend.connect()
   await backend.write('hello.txt', 'Hello from Kubernetes!')
   await backend.destroy()
   ```

   Use `agentbe-daemon.<namespace>.svc.cluster.local` from another namespace.
   The application needs the same token, normally through its own Kubernetes
   Secret reference.

5. For a local connectivity check, forward the Service and use the local Docker
   client settings:

   ```bash
   kubectl port-forward service/agentbe-daemon 3001:3001
   curl http://127.0.0.1:3001/health
   ```

Keep the Service cluster-internal. Apply the cluster's pod security, network
policy, resource limit, image pinning, and backup requirements before using this
as a production deployment.

The published daemon image is currently amd64-only, so the manifest selects an
amd64 node. Kubernetes does not add CPU emulation automatically. For an arm64-only
cluster, build and push a native image from
[`agentbe-daemon/docker/Dockerfile`](../agentbe-daemon/docker/Dockerfile), change
the Deployment's `image`, and remove or update the `nodeSelector`.

## Core daemon vs. Agent Document Room

The setups above deploy the core Agent Backend library or daemon. A daemon
Deployment in Kubernetes is one workspace behind one service; it is not a
per-session sandbox orchestrator.

[Agent Document Room](../room/README.md) is a separate service built on Agent
Backend. It can provision a Docker container or Kubernetes pod for each session.
Use the [Room Kubernetes example](../room/examples/k8s/README.md) for the runnable
per-session setup and [Room deployment](room-deployment.md) for provider choice,
RBAC, warm pools, and network policy.
