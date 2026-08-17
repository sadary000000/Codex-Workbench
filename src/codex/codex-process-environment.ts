const PROXY_PAIRS = [
  ["HTTP_PROXY", "http_proxy"],
  ["HTTPS_PROXY", "https_proxy"],
  ["ALL_PROXY", "all_proxy"],
] as const;
const WEBSOCKET_PROXY_KEYS = ["WS_PROXY", "WSS_PROXY", "ws_proxy", "wss_proxy"];
const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

function split(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function createCodexProcessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of WEBSOCKET_PROXY_KEYS) delete environment[key];
  for (const [upper, lower] of PROXY_PAIRS) {
    const value = environment[upper] || environment[lower];
    if (value) {
      environment[upper] = value;
      environment[lower] = value;
    }
  }
  const noProxy = [...new Set([
    ...split(environment.NO_PROXY),
    ...split(environment.no_proxy),
    ...LOOPBACK,
  ])].join(",");
  environment.NO_PROXY = noProxy;
  environment.no_proxy = noProxy;
  return environment;
}
