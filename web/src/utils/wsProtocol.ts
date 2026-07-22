/** Select the first websocket subprotocol requested by the browser. */
export function selectWebSocketProtocol(protocols: Set<string>): string | false {
  return protocols.values().next().value ?? false
}
