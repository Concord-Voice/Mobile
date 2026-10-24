import type { SocketLike } from './DmSocket';

/**
 * The mobile app's fixed WebSocket origin. The control and media planes accept a socket
 * only from an origin on ALLOWED_ORIGINS, and this one is listed there for the app.
 * Without it, React Native would send the server's own host as the origin and be refused.
 */
export const MOBILE_ORIGIN = 'app://concord-mobile';

// React Native's WebSocket takes a third options argument that browsers do not have.
type NativeWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> },
) => SocketLike;

export function createSocket(url: string): SocketLike {
  const Socket = WebSocket as unknown as NativeWebSocket;
  return new Socket(url, undefined, { headers: { Origin: MOBILE_ORIGIN } });
}
