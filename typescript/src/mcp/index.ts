// Client helpers
export { createAgentBeMCPClient, createAgentBeMCPTransport, type AgentBeMCPClient, type AgentBeMCPClientOptions } from './client.js'

// TODO Phase 8: local-client.ts uses archived Config.js - temporarily excluded
// export { createLocalAgentBeMCPClient, type LocalAgentBeMCPClient, type LocalAgentBeMCPClientOptions } from './local-client.js'

// Tools registration (for custom server implementations)
export { registerTools } from './tools.js'
