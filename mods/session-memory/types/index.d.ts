// The inputs of the tools this mod registers, so its own hooks are type-checked against them.
declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__session-memory__mark': { kind: string; note?: string; target?: string }
    'mcp__session-memory__search': { query: string; kinds?: string[]; scope?: string; limit?: number }
    'mcp__session-memory__session_trail': { query?: string }
    'mcp__session-memory__investigate_error': { failing_tool?: string; error: string; tried?: string }
  }
}
export {}
