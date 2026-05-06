// # Copyright 2026, University of Maryland, All Rights Reserved

import { useCallback } from 'react';
import type { Region } from '../utils/regionUtils';
import {getApiUrl} from './useWebSocket';

export function useCommandHandler(
    processFile: (file: File) => void,
    colormap: string, setColormap: (cmap: string) => void,
    stretch: string, setStretch: (cmap: string) => void,
    regions: any[], setRegions: (updater: any) => void,
) {
  return useCallback(async (command: any, sendReply: (msg: any) => void) => {
    console.log("Received remote command:", command);

    // Helper to send a simple OK
    const ack = () => sendReply({ message_id: command.message_id, status: 'ok' });

    // Helper to send data
    const replyData = (data: any) => sendReply({ message_id: command.message_id, ...data });
    
    switch (command.action) {
      case 'load_file':
        try {
          const response = await fetch(getApiUrl(`api/file?path=${encodeURIComponent(command.path)}`));
          if (!response.ok) throw new Error("Failed to fetch file");
          
          const blob = await response.blob();
          const filename = command.path.split('/').pop() || 'remote.fits';
          
          // Create the File object and pass it to your app's logic
          const file = new File([blob], filename, { type: 'application/octet-stream' });
          processFile(file);
          ack();
          
        } catch (error) {
          console.error("Error loading remote file:", error);
        }
        break;
    
    case 'set_colormap':
      if (command.cmap) setColormap(command.cmap);
      ack();
      break;

    case 'get_colormap':
      replyData({ colormap });
      break;

    case 'get_stretch':
      replyData({ stretch });
      break;
    
    case 'set_stretch':
      if (command.stretch) setStretch(command.stretch);
      ack();
      break;
    
    case 'get_regions':
      replyData({ regions });
      break;

    case 'clear_regions':
      setRegions([]);
      ack();
      break;

    case 'add_region': { // Note the curly braces to scope variables
      const { type, x, y, color = '#00ff00', angle = 0 } = command;
      
      let r: Region = { 
          id: `api_${Date.now()}_${Math.floor(Math.random()*1000)}`, 
          type, 
          startX: 0, startY: 0, 
          endX: 0, endY: 0, 
          color, 
          angle
      };

      if (type === 'circle') {
          r.startX = x; r.startY = y;
          r.endX = x + command.radius; r.endY = y;
      } else if (type === 'box') {
          r.startX = x - command.width/2; r.startY = y - command.height/2;
          r.endX = x + command.width/2; r.endY = y + command.height/2;
      } else if (type === 'ellipse') {
          r.startX = x; r.startY = y;
          r.endX = x + command.rx; r.endY = y + command.ry;
      } else if (type === 'annulus') {
          r.startX = x; r.startY = y;
          r.innerR = command.innerR;
          r.endX = x + command.outerR; r.endY = y;
      }
      setRegions((prev: any[]) => [...prev, r]);
      ack();
      break;
    }
    
    default:
      sendReply({ message_id: command.message_id, error: `Unknown command: ${command.action}` });
    }
  }, [processFile, colormap, setColormap, stretch, setStretch, regions, setRegions]);
}