// Tells the SchemaSketch API which client and MCP tool a request comes from,
// so the backoffice can count usage (counts only; see the backend's
// App\Support\ApiUsage). Each tool call runs inside runTool(), and the HTTP
// client reads the name back with currentTool(), so concurrent calls on the
// hosted server never mix up their names.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';

let version = '0.0.0';
try {
  version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || version;
} catch {
  // A copy without package.json still names itself as the MCP client.
}

export const USER_AGENT = `SchemaSketch-MCP/${version}`;

const storage = new AsyncLocalStorage();

export function runTool(name, fn) {
  return storage.run(name, fn);
}

export function currentTool() {
  return storage.getStore();
}

// Wraps McpServer#tool so every handler runs inside runTool(name).
export function withToolContext(register) {
  return (name, ...rest) => {
    const handler = rest.pop();
    return register(name, ...rest, (...args) => runTool(name, () => handler(...args)));
  };
}
