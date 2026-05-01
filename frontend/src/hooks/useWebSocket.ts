import { useEffect, useRef, useState } from 'react';

// This will return "/" in standalone, or "/fviewer/" in JupyterLab
export function getBasePath(): string {
  let path = window.location.pathname;
  return path.endsWith('/') ? path : path + '/';
}

// FOR HTTP (API CALLS)
export function getApiUrl(endpoint: string): string {
  // endpoint should be passed WITHOUT a leading slash (e.g., 'api/fs/list')
  return `${getBasePath()}${endpoint}`;
}

// 2. FOR WEBSOCKETS (Cleaned up)
export function getWebSocketUrl(clientId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  
  return `${protocol}//${host}${getBasePath()}ws/${clientId}`;
}

export function useWebSocket(onCommand: (command: any, sendReply: (msg: any) => void) => void) {
  const [clientId] = useState(() => crypto.randomUUID());
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Keep the latest callback in a ref to prevent infinite loops
  const savedCallback = useRef(onCommand);
  useEffect(() => {
    savedCallback.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    const wsUrl = getWebSocketUrl(clientId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      const command = JSON.parse(event.data);
      // 1. Create the reply function dynamically
      const sendReply = (msg: any) => {
          if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(msg));
          }
      };

      // 2. Pass BOTH the command AND the reply function to your handler
      savedCallback.current(command, sendReply);
    };

    return () => ws.close();
  }, [clientId]); // 3. Removed onCommand from here

  return { clientId, isConnected };
}