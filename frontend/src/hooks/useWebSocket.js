import { useCallback, useEffect, useRef, useState } from "react";

// Connects to the room WebSocket and surfaces a send() plus the latest
// message. Auto-reconnects with backoff; the server replays room_state on
// connect so reconnection is seamless.
//
// "Intentional" closes (component unmount, React StrictMode's double-mount)
// are tagged on the socket itself rather than via a shared ref, so a throwaway
// socket's onclose never triggers a phantom reconnect on the live socket.
export function useWebSocket(roomId, userName, onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const retryRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    if (!roomId || !userName) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/${roomId}/${encodeURIComponent(
      userName
    )}`;
    const ws = new WebSocket(url);
    ws._intentional = false;
    wsRef.current = ws;

    ws.onopen = () => {
      // If we were torn down while connecting, close cleanly now.
      if (ws._intentional) {
        ws.close();
        return;
      }
      setConnected(true);
      retryRef.current = 0;
    };
    ws.onmessage = (e) => {
      try {
        onMessageRef.current?.(JSON.parse(e.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) setConnected(false);
      // Don't reconnect if this socket was closed on purpose, or if it's no
      // longer the active socket.
      if (ws._intentional || wsRef.current !== ws) return;
      const delay = Math.min(1000 * 2 ** retryRef.current, 8000);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, [roomId, userName]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      const ws = wsRef.current;
      if (!ws) return;
      ws._intentional = true; // suppress reconnect for this socket
      if (ws.readyState === WebSocket.OPEN) ws.close();
      // if still CONNECTING, onopen will close it cleanly (see above)
    };
  }, [connect]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  return { connected, send };
}
