# Agent Backend - NextJS Demo

Full-featured demo showcasing agent-backend with AI chat, file management, and direct backend editing.

## Features

- 🤖 **AI Chat** - Streaming responses via HTTP + SSE with tool execution visibility
- 📁 **File Explorer** - Real-time file tree with upload/download capabilities
- ✏️ **Code Editor** - Monaco editor for direct file editing with syntax highlighting
- 🔌 **Flexible Backend** - Support for both local and remote (SSH) backends
- 🎨 **Professional UI** - Enterprise-appropriate design with modern aesthetics

## Quick Start

### 1. Install Dependencies

```bash
cd examples/NextJS
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
# Required
AGENTBE_WORKSPACE_ROOT=/tmp/agentbe-workspace
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Backend type (local or remote)
NEXT_PUBLIC_BACKEND_TYPE=local

# Optional (only if NEXT_PUBLIC_BACKEND_TYPE=remote)
REMOTE_VM_HOST=example.com
REMOTE_VM_USER=agent
REMOTE_VM_PASSWORD=secret
REMOTE_MCP_URL=http://example.com:3001
```

### 3. Create Workspace Directory

```bash
mkdir -p /tmp/agentbe-workspace
```

### 4. Run Development Server

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Remote Setup (Optional)

If you want to use a remote backend with an MCP server running on a remote host:

**On the remote host:**

```bash
# Start MCP server on remote machine
agent-backend \
  --backend local \
  --rootDir /workspace \
  --http-port 3001
```

**On your local machine (NextJS app):**

Configure `.env.local` for remote:

```bash
AGENTBE_WORKSPACE_ROOT=/workspace
NEXT_PUBLIC_BACKEND_TYPE=remote
REMOTE_VM_HOST=remote-server.com
REMOTE_VM_USER=agent
REMOTE_VM_PASSWORD=secret
REMOTE_MCP_URL=http://remote-server.com:3001
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Then run the NextJS app:

```bash
pnpm run dev
```

## Architecture

### Real-Time AI Chat

The app uses **HTTP + Server-Sent Events (SSE)** for streaming AI responses:

1. **User sends message**: `POST /api/chat` with message content
2. **Server initiates stream**: Returns `streamUrl` for SSE connection
3. **Client connects to SSE**: `EventSource` listens for streaming events
4. **AI streams response**: Server sends `text_delta`, `tool_start`, `tool_result` events
5. **Stream completes**: Server sends `message_end` and closes connection

**Why SSE instead of WebSocket?**
- ✅ Works natively in Next.js App Router (no custom server needed)
- ✅ Built-in browser API (`EventSource`)
- ✅ Perfect for one-way server→client streaming
- ✅ Automatic reconnection
- ✅ Simple HTTP response with `text/event-stream` content-type

### Local Development

```
NextJS App (localhost:3000)
├── HTTP + SSE → AI Chat (MCP protocol)
│   └── backend.getMCPClient()
│       └── Spawns: agent-backend CLI (stdio)
│           └── LocalFilesystemBackend
│               └── Local files
└── HTTP → File Operations (Direct backend access)
```

**Automatic MCP Server Management**: The MCP server is automatically spawned and managed by `LocalFilesystemBackend.getMCPClient()`. No separate process to start manually!

### Remote Deployment

```
Remote Host:
  agent-backend CLI (HTTP on port 3001)
    └── LocalFilesystemBackend
        └── Remote files

NextJS App (anywhere):
├── HTTP + SSE → AI Chat (MCP protocol)
│   └── backend.getMCPClient()
│       └── HTTP Client
│           └── Connects to remote-host:3001
└── HTTP → File Operations (Direct backend via SSH)
```

**Key Principle**: "The MCP server has to be in the same system as the files it manages."

For remote backends, the MCP server runs on the remote host with direct filesystem access, avoiding SSH overhead for every file operation.

## Usage

### Chat with AI

1. Type a message in the chat input
2. AI responses stream in real-time
3. Tool executions appear as collapsible cards
4. Files created by AI automatically appear in the explorer

### File Management

- **Upload**: Click "Upload" button in file explorer
- **Download**: Click download icon on file hover
- **Edit**: Click file to open in editor
- **Save**: Use Cmd/Ctrl+S or click Save button

### Editing Files

- Monaco editor provides full IDE features
- Syntax highlighting based on file extension
- Format JSON files with Format button
- Auto-save indication when changes are pending

## Development

### Zero-Build Local Development

This demo is optimized for fast local development with **zero build steps**:

**agent-backend TypeScript transpilation**: Next.js transpiles the `agent-backend` package directly from TypeScript using the `transpilePackages` config. No need to rebuild the backend when you make changes.

```javascript
// next.config.js
transpilePackages: ['agent-backend']
```

**Automatic MCP Server Management**: The MCP server is automatically managed by the backend.

```typescript
// app/lib/mcp-client.ts
const backend = await backendManager.getBackend()
const client = await backend.getMCPClient()  // Spawns CLI automatically for local
```

**Benefits:**
- MCP server automatically spawned and managed
- Works locally and remotely with same API
- Hot reload: Changes to agent-backend source code are picked up automatically on next request
- No manual MCP server management needed

### Daily Development Workflow

```bash
# Just run the dev server
pnpm run dev

# Make changes to:
# - typescript/src/** (agent-backend)
# - examples/NextJS/app/** (NextJS app)

# Changes are picked up automatically!
```

### What Happens When You Edit Code

**Editing agent-backend** (`typescript/src/`):
1. Save file in `typescript/src/backends/LocalFilesystemBackend.ts`
2. Next request to API route triggers re-transpilation
3. New code is used immediately
4. No manual build step needed

**Editing NextJS app** (`app/`):
1. Save file in `app/components/Chat.tsx`
2. Next.js Fast Refresh updates browser automatically
3. No restart needed (standard Next.js behavior)

### Package Dependencies

The demo uses a pnpm workspace dependency:

```json
{
  "dependencies": {
    "agent-backend": "workspace:*"
  }
}
```

During `pnpm install`, this package is linked from the workspace, making source changes immediately available.

## Tech Stack

### Frontend
- **Next.js 15** - App Router with React Server Components
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Monaco Editor** - VS Code editor component
- **React Markdown** - Message formatting

### Backend
- **agent-backend** - Core backend library (local file reference)
- **MCP SDK** - Model Context Protocol for AI tools
- **Server-Sent Events (SSE)** - Real-time streaming communication
- **OpenRouter** - AI model provider

## Project Structure

```
examples/NextJS/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   ├── route.ts             # POST endpoint for messages
│   │   │   └── stream/route.ts      # SSE streaming endpoint
│   │   └── files/
│   │       ├── tree/route.ts        # List files
│   │       ├── read/route.ts        # Read file
│   │       ├── write/route.ts       # Write file
│   │       ├── upload/route.ts      # Upload file
│   │       └── download/route.ts    # Download file
│   ├── components/
│   │   ├── Header.tsx               # Top bar with status
│   │   ├── FileExplorer.tsx         # File tree panel
│   │   ├── Chat.tsx                 # Chat interface
│   │   └── Editor.tsx               # Monaco editor panel
│   ├── lib/
│   │   ├── backend.ts               # Backend manager
│   │   ├── mcp-client.ts            # MCP client setup (in-process)
│   │   └── types.ts                 # TypeScript types
│   ├── page.tsx                     # Main app layout
│   └── layout.tsx                   # Root layout
├── package.json
├── next.config.js
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTBE_WORKSPACE_ROOT` | ✅ Yes | - | Workspace directory path |
| `OPENROUTER_API_KEY` | ✅ Yes | - | OpenRouter API key for AI |
| `NEXT_PUBLIC_BACKEND_TYPE` | ❌ No | `local` | Backend type: `local` or `remote` |
| `REMOTE_VM_HOST` | If remote | - | SSH hostname for remote backend |
| `REMOTE_VM_USER` | If remote | - | SSH username |
| `REMOTE_VM_PASSWORD` | If remote | - | SSH password (or use `REMOTE_VM_PRIVATE_KEY`) |
| `REMOTE_VM_PRIVATE_KEY` | If remote | - | Path to SSH private key file |
| `REMOTE_MCP_URL` | If remote | - | MCP server URL on remote host (e.g., `http://remote-server.com:3001`) |
| `REMOTE_MCP_AUTH_TOKEN` | ❌ No | - | Optional authentication token for remote MCP server |

## Troubleshooting

### "Cannot find module 'agent-backend'"

**Cause**: pnpm install not run, or symlink broken

**Fix**:
```bash
cd examples/NextJS
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### MCP Connection Failed (Local)

**Symptom**: "Failed to spawn agent-backend CLI" or "MCP tools not available"

**Causes**:
1. `agent-backend` CLI not in PATH
2. TypeScript package not built

**Fix**:
```bash
# Build agent-backend package
cd ../../typescript
pnpm run build
pnpm link --global

# Verify CLI is available
agent-backend --help
```

### MCP Connection Failed (Remote)

**Symptom**: "Connection refused" or "MCP connection timed out"

**Causes**:
1. MCP server not running on remote host
2. Wrong URL in `REMOTE_MCP_URL`
3. Firewall blocking port 3001

**Fix**:
```bash
# On remote host, check if MCP server is running
curl http://localhost:3001/health
# Expected: {"status":"ok","backend":"local"}

# If not running, start it
agent-backend --backend local --rootDir /workspace --http-port 3001

# Check if port is accessible from local machine
curl http://remote-server.com:3001/health
```

### SSE Connection Failed

**Symptom**: "Stream not found" or "Failed to send message"

**Fix**:
- Ensure dev server is running on expected port
- Check browser console for errors
- Verify POST to `/api/chat` completes successfully
- Check Network tab for SSE connection to `/api/chat/stream`

### Backend Connection Failed

- Verify `AGENTBE_WORKSPACE_ROOT` exists and is writable
- For remote: check SSH credentials and connectivity
- Check server logs for detailed error messages

### AI Not Responding

- Verify `OPENROUTER_API_KEY` is set correctly
- Check OpenRouter API status
- Review browser network tab for API errors

### Changes to agent-backend not appearing

**Cause**: Next.js cache issue

**Fix**:
```bash
rm -rf .next
pnpm run dev
```

## License

Part of the agent-backend project. See root LICENSE for details.
