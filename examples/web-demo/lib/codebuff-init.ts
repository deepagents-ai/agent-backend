import { CodebuffClient } from '@codebuff/sdk'
import { type FileSystem } from 'agent-backend'

/**
 * Create a new Codebuff client with AgentBackend workspace.
 * Uses direct workspace integration (fsSource).
 *
 * Clients are stateless, so we create a new instance for each request.
 */
export async function getCodebuffClient(fs: FileSystem, apiKey: string) {
  const workspace = await fs.getWorkspace('default')

  console.log('[CODEBUFF] Creating client for workspace:', workspace.workspacePath)

  return new CodebuffClient({
    apiKey,
    cwd: workspace.workspacePath,
    fsSource: workspace
  })
}
