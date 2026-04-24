import { useEffect, useRef, useState } from 'react';

// Utility to build a robust WebSocket URL
function getWebSocketUrl(clientId: string): string {
  // 1. Check for an explicit override in the URL params
  // e.g., https://fviewer.local/?ws_url=wss://remote-server.com/jupyter/proxy/8000/ws
  const params = new URLSearchParams(window.location.search);
  const wsOverride = params.get('ws_url');
  
  if (wsOverride) {
    // Ensure no trailing slash before appending clientId
    return `${wsOverride.replace(/\/$/, '')}/${clientId}`;
  }

  // 2. Fallback to current location (works if served directly by FastAPI)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  let basePath = window.location.pathname;
  
  if (!basePath.endsWith('/')) {
    basePath += '/';
  }
  
  return `${protocol}//${host}${basePath}ws/${clientId}`;
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