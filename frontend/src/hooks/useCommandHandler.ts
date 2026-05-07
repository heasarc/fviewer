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
          // Safely extract the message
          const errorMessage = error instanceof Error 
            ? error.message 
            : "An unknown network error occurred";
            
          // Send the error back to release the Python client instantly!
          sendReply({ message_id: command.message_id, error: errorMessage });
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
      if (command.format === 'fk5' || command.format === 'wcs') {
        if (!imageData || !imageData.pixScale || !pixToWorld) {
            return sendReply({ message_id: command.message_id, error: "Image data, pixel scale, or WCS not ready." });
        }

        // Use the native WCS scale provided by your FITS header
        const scaleX = Math.abs(imageData.pixScale.scaleX || 1);
        const scaleY = Math.abs(imageData.pixScale.scaleY || 1);
        const avgScale = (scaleX + scaleY) / 2;

        const wcsRegions = [];
        for (const r of regions) {
          let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

          // Scale dimensions accurately using X/Y axes
          if (r.type === 'box') {
              w = Math.abs(r.endX - r.startX) * scaleX;
              h = Math.abs(r.endY - r.startY) * scaleY;
              cx = (r.startX + r.endX) / 2; cy = (r.startY + r.endY) / 2;
          } else if (r.type === 'ellipse') {
              w = Math.abs(r.endX - r.startX) * 2 * scaleX; 
              h = Math.abs(r.endY - r.startY) * 2 * scaleY; 
              cx = r.startX; cy = r.startY;
          } else { 
              // Pixel hypotenuse * average scale
              radius = Math.hypot(r.endX - r.startX, r.endY - r.startY) * avgScale;
              cx = r.startX; cy = r.startY;
          }

          const world = await pixToWorld(cx, cy);
          if (!world) continue;

          const base = { id: r.id, type: r.type, color: r.color, angle: r.angle, isBackground: r.isBackground, ra: world.ra, dec: world.dec };
          
          if (r.type === 'box') wcsRegions.push({ ...base, width: w, height: h });
          else if (r.type === 'ellipse') wcsRegions.push({ ...base, rx: w/2, ry: h/2 });
          else if (r.type === 'annulus') wcsRegions.push({ ...base, innerR: (r.innerR || radius/2) * avgScale, outerR: radius });
          else wcsRegions.push({ ...base, radius });
        }
        replyData({ regions: wcsRegions });
      } else {
        replyData({ regions });
      }
      break;


    case 'clear_regions':
      setRegions([]);
      ack();
      break;

    case 'add_region': { 

      const validTypes = ['circle', 'box', 'ellipse', 'annulus'];
      if (!validTypes.includes(command.type)) {
          return sendReply({ message_id: command.message_id, error: `Invalid region type: ${command.type}` });
      }

      const validFormats = ['image', 'wcs', 'fk5'];
      if (!validFormats.includes(command.format)) {
          return sendReply({ message_id: command.message_id, error: `Invalid region format: ${command.type}` });
      }
      let { format = 'image' } = command;

      // Validate that color is a valid hex or standard color string to prevent injection
      const colorRegex = /^#([0-9A-F]{3}){1,2}$|^[a-zA-Z]+$/i;
      let color = colorRegex.test(command.color) ? command.color : '#00ff00';
      
      // Ensure coordinates are actual numbers, not NaN or undefined
      if (typeof command.x !== 'number' || typeof command.y !== 'number') {
          return sendReply({ message_id: command.message_id, error: "Coordinates must be numbers." });
      }
      let {x, y} = command;

      if (typeof command.radius !== 'number') {
          return sendReply({ message_id: command.message_id, error: "radius must be numbers." });
      }

      if (typeof command.angle !== 'number') {
          return sendReply({ message_id: command.message_id, error: "angle must be numbers." });
      }
      let { angle = 0 } = command;


      let { type, isBackground = false } = command;
      let radius = command.radius, width = command.width, height = command.height;
      let rx = command.rx, ry = command.ry, innerR = command.innerR, outerR = command.outerR;

      // 2. CONVERT FROM WCS TO PIXELS IF REQUESTED
      if (format === 'fk5' || format === 'wcs') {
          if (!imageData || !imageData.pixScale || !worldToPix) {
              return sendReply({ message_id: command.message_id, error: "Image data, pixel scale, or WCS not ready." });
          }

          // Use the native WCS scale
          const scaleX = Math.abs(imageData.pixScale.scaleX || 1);
          const scaleY = Math.abs(imageData.pixScale.scaleY || 1);
          const avgScale = (scaleX + scaleY) / 2;

          // Convert center
          const pix = await worldToPix(x, y);
          if (!pix || pix.x === undefined || pix.y === undefined) {
              return sendReply({ message_id: command.message_id, error: "Invalid WCS coordinates." });
          }
          x = pix.x;
          y = pix.y;

          // Convert sizes (degrees -> pixels) using accurate factors
          if (radius !== undefined) radius /= avgScale;
          if (width !== undefined) width /= scaleX;
          if (height !== undefined) height /= scaleY;
          if (rx !== undefined) rx /= scaleX;
          if (ry !== undefined) ry /= scaleY;
          if (innerR !== undefined) innerR /= avgScale;
          if (outerR !== undefined) outerR /= avgScale;
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
  }, [processFile, colormap, setColormap, stretch, setStretch, regions, setRegions,
      imageData, pixToWorld, worldToPix]);
}