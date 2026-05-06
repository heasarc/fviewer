// # Copyright 2026, University of Maryland, All Rights Reserved

import { useCallback } from 'react';
import type { Region } from '../utils/regionUtils';
import {getApiUrl} from './useWebSocket';

export function useCommandHandler(
    processFile: (file: File) => void,
    colormap: string, setColormap: (cmap: string) => void,
    stretch: string, setStretch: (cmap: string) => void,
    regions: any[], setRegions: (updater: any) => void,
    imageData: any,
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    worldToPix: (ra: number, dec: number) => Promise<{ x: number, y: number } | null>
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
      // CHECK FORMAT AND CONVERT TO WCS IF REQUESTED
      if (command.format === 'fk5' || command.format === 'wcs') {
        if (!imageData || !pixToWorld) {
            return sendReply({ message_id: command.message_id, error: "Image data or WCS not ready." });
        }

        const { width, height } = imageData;
        let pixScale = 1;
        const c1 = await pixToWorld(width / 2, height / 2);
        const c2 = await pixToWorld((width / 2) + 1, height / 2);
        if (c1 && c2) {
            pixScale = Math.hypot((c2.ra - c1.ra) * Math.cos(c1.dec * Math.PI / 180), c2.dec - c1.dec);
        }

        const wcsRegions = [];
        for (const r of regions) {
          let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

          if (r.type === 'box') {
              w = Math.abs(r.endX - r.startX) * pixScale;
              h = Math.abs(r.endY - r.startY) * pixScale;
              cx = (r.startX + r.endX) / 2; cy = (r.startY + r.endY) / 2;
          } else if (r.type === 'ellipse') {
              w = Math.abs(r.endX - r.startX) * 2 * pixScale; 
              h = Math.abs(r.endY - r.startY) * 2 * pixScale; 
              cx = r.startX; cy = r.startY;
          } else { 
              radius = Math.hypot(r.endX - r.startX, r.endY - r.startY) * pixScale;
              cx = r.startX; cy = r.startY;
          }

          const world = await pixToWorld(cx, cy);
          if (!world) continue; // Skip if WCS conversion fails

          // Build a clean dictionary for the Python user
          const base = { id: r.id, type: r.type, color: r.color, angle: r.angle, isBackground: r.isBackground, ra: world.ra, dec: world.dec };
          
          if (r.type === 'box') wcsRegions.push({ ...base, width: w, height: h });
          else if (r.type === 'ellipse') wcsRegions.push({ ...base, rx: w/2, ry: h/2 });
          else if (r.type === 'annulus') wcsRegions.push({ ...base, innerR: (r.innerR || radius/2) * pixScale, outerR: radius });
          else wcsRegions.push({ ...base, radius });
        }
        replyData({ regions: wcsRegions });
      } else {
        // Default image/pixel fallback
        replyData({ regions });
      }
      break;


    case 'clear_regions':
      setRegions([]);
      ack();
      break;

    case 'add_region': { 
      let { type, x, y, color = '#00ff00', angle = 0, format = 'image', isBackground = false } = command;
      let radius = command.radius, width = command.width, height = command.height;
      let rx = command.rx, ry = command.ry, innerR = command.innerR, outerR = command.outerR;

      // 2. CONVERT FROM WCS TO PIXELS IF REQUESTED
      if (format === 'fk5' || format === 'wcs') {
          if (!imageData || !worldToPix || !pixToWorld) {
              return sendReply({ message_id: command.message_id, error: "Image data or WCS not ready." });
          }

          // Calculate pixel scale
          let pixScale = 1;
          const c1 = await pixToWorld(imageData.width / 2, imageData.height / 2);
          const c2 = await pixToWorld((imageData.width / 2) + 1, imageData.height / 2);
          if (c1 && c2) {
              pixScale = Math.hypot((c2.ra - c1.ra) * Math.cos(c1.dec * Math.PI / 180), c2.dec - c1.dec);
          }

          // Convert center
          const pix = await worldToPix(x, y);
          if (!pix || pix.x === undefined || pix.y === undefined) {
              return sendReply({ message_id: command.message_id, error: "Invalid WCS coordinates." });
          }
          x = pix.x;
          y = pix.y;

          // Convert sizes (degrees -> pixels)
          const scaleFactor = 1 / pixScale;
          if (radius !== undefined) radius *= scaleFactor;
          if (width !== undefined) width *= scaleFactor;
          if (height !== undefined) height *= scaleFactor;
          if (rx !== undefined) rx *= scaleFactor;
          if (ry !== undefined) ry *= scaleFactor;
          if (innerR !== undefined) innerR *= scaleFactor;
          if (outerR !== undefined) outerR *= scaleFactor;
      }
      
      let r: Region = { 
          id: `api_${Date.now()}_${Math.floor(Math.random()*1000)}`, 
          type, 
          startX: 0, startY: 0, endX: 0, endY: 0, 
          color, angle, isBackground 
      };

      // 3. BUILD REGION USING THE SCALED VARIABLES
      if (type === 'circle') {
          r.startX = x; r.startY = y;
          r.endX = x + radius; r.endY = y;
      } else if (type === 'box') {
          r.startX = x - width/2; r.startY = y - height/2;
          r.endX = x + width/2; r.endY = y + height/2;
      } else if (type === 'ellipse') {
          r.startX = x; r.startY = y;
          r.endX = x + rx; r.endY = y + ry;
      } else if (type === 'annulus') {
          r.startX = x; r.startY = y;
          r.innerR = innerR;
          r.endX = x + outerR; r.endY = y;
      }

      setRegions((prev: any[]) => [...prev, r]);
      ack();
      break;
    }
    
    default:
      sendReply({ message_id: command.message_id, error: `Unknown command: ${command.action}` });
    }
  }, [processFile, colormap, setColormap, stretch, setStretch, regions, setRegions, imageData, pixToWorld]);
}