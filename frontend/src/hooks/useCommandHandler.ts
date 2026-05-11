// # Copyright 2026, University of Maryland, All Rights Reserved

/**
 * @fileoverview Command Handler Hook for FViewer.
 * 
 * This hook acts as the central router for all commands coming from the Python 
 * client (via the FastAPI WebSocket). It intercepts JSON payloads, safely validates 
 * and sanitizes the data, updates the React UI state, and asynchronously sends 
 * acknowledgments or requested data back through the WebSocket.
 */

import { useCallback } from 'react';
import type { Region } from '../utils/regionUtils';
import { getApiUrl } from './useWebSocket';
import { parseDS9Regions, serializeDS9Regions } from '../utils/regionUtils';

/**
 * Creates a memoized command handler callback.
 * 
 * @param processFile - Callback to handle a newly loaded FITS File object.
 * @param colormap - Current active colormap string.
 * @param setColormap - State setter for the colormap.
 * @param stretch - Current active image stretch string.
 * @param setStretch - State setter for the stretch.
 * @param regions - Array of currently drawn regions.
 * @param setRegions - State setter for the regions array.
 * @param imageData - Current image metadata (width, height, WCS pixScale).
 * @param pixToWorld - Async function calling the WASM worker to convert Pixels to RA/Dec.
 * @param worldToPix - Async function calling the WASM worker to convert RA/Dec to Pixels.
 * @returns An async function `(command, sendReply)` to be bound to the WebSocket listener.
 */
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

    // Helper to send a simple status acknowledgment back to the Python client
    const ack = () => sendReply({ message_id: command.message_id, status: 'ok' });

    // Helper to send a data payload back to the Python client
    const replyData = (data: any) => sendReply({ message_id: command.message_id, ...data });
    
    switch (command.action) {
      case 'load_file':
        try {
          // Fetch the file through the FastAPI backend to ensure path traversal 
          // restrictions are enforced by the server.
          const response = await fetch(getApiUrl(`api/file?path=${encodeURIComponent(command.path)}`));
          if (!response.ok) throw new Error("Failed to fetch file");
          
          const blob = await response.blob();
          const filename = command.path.split('/').pop() || 'remote.fits';
          
          // Create the File object and pass it to the app's internal Web Worker logic
          const file = new File([blob], filename, { type: 'application/octet-stream' });
          processFile(file);
          ack();
          
        } catch (error) {
          console.error("Error loading remote file:", error);
          // Safely extract the message without leaking internal stack traces
          const errorMessage = error instanceof Error 
            ? error.message 
            : "An unknown network error occurred";
            
          // Send the error back to release the Python client instantly (prevents timeouts)
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
      if (command.format === 'physical') {
          const ltv1 = imageData?.ltv1 ?? 0;
          const ltv2 = imageData?.ltv2 ?? 0;
          const ltm1_1 = imageData?.ltm1_1 ?? 1;
          const ltm2_2 = imageData?.ltm2_2 ?? 1;
          const avgLtm = Math.abs(ltm1_1 + ltm2_2) / 2;

          const physRegions = regions.map(r => {
              let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

              // Calculate image pixel sizes
              if (r.type === 'box') {
                  w = Math.abs(r.endX - r.startX) / Math.abs(ltm1_1);
                  h = Math.abs(r.endY - r.startY) / Math.abs(ltm2_2);
                  cx = (r.startX + r.endX) / 2; cy = (r.startY + r.endY) / 2;
              } else if (r.type === 'ellipse') {
                  w = Math.abs(r.endX - r.startX) * 2 / Math.abs(ltm1_1); 
                  h = Math.abs(r.endY - r.startY) * 2 / Math.abs(ltm2_2); 
                  cx = r.startX; cy = r.startY;
              } else { 
                  radius = Math.hypot(r.endX - r.startX, r.endY - r.startY) / avgLtm;
                  cx = r.startX; cy = r.startY;
              }

              // Image to Physical math: Phys = (Image - LTV) / LTM
              const physX = (cx - ltv1) / ltm1_1;
              const physY = (cy - ltv2) / ltm2_2;

              const base = { id: r.id, type: r.type, color: r.color, angle: r.angle, isBackground: r.isBackground, physical_x: physX, physical_y: physY };
              
              if (r.type === 'box') return { ...base, width: w, height: h };
              if (r.type === 'ellipse') return { ...base, rx: w/2, ry: h/2 };
              if (r.type === 'annulus') return { ...base, innerR: (r.innerR || radius/2) / avgLtm, outerR: radius };
              return { ...base, radius };
          });
          replyData({ regions: physRegions });

      } else if (command.format === 'fk5' || command.format === 'wcs') {
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

          // Scale dimensions accurately using X/Y axes into WCS degrees
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

          // Await WASM conversion
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
      // ==========================================
      // SECURITY & SANITIZATION BOUNDARY
      // Do not trust external WebSocket payloads!
      // ==========================================

      const validTypes = ['circle', 'box', 'ellipse', 'annulus'];
      if (!validTypes.includes(command.type)) {
          return sendReply({ message_id: command.message_id, error: `Invalid region type: ${command.type}` });
      }

      const validFormats = ['image', 'wcs', 'fk5', 'physical'];
      if (!validFormats.includes(command.format)) {
          return sendReply({ message_id: command.message_id, error: `Invalid region format: ${command.format}` });
      }
      let { format = 'image' } = command;

      // SECURITY: Validate that color is a valid hex or standard color string.
      // Prevents malicious injection into the SVG `stroke` properties.
      const colorRegex = /^#([0-9A-F]{3}){1,2}$|^[a-zA-Z]+$/i;
      let color = colorRegex.test(command.color) ? command.color : '#00ff00';
      
      // SECURITY: Ensure coordinates are actual numbers, not NaN, undefined, or exploit payloads
      if (typeof command.x !== 'number' || typeof command.y !== 'number') {
          return sendReply({ message_id: command.message_id, error: "Coordinates must be numbers." });
      }
      let {x, y} = command;

      if (typeof command.radius !== 'number') {
          return sendReply({ message_id: command.message_id, error: "radius must be numbers." });
      }

      let { angle = 0 } = command;
      let { type, isBackground = false } = command;
      let radius = command.radius, width = command.width, height = command.height;
      let rx = command.rx, ry = command.ry, innerR = command.innerR, outerR = command.outerR;

      // 2. CONVERT TO PIXELS (IMAGE) IF REQUESTED
      if (format === 'physical') {
          // Fallbacks in case the image data isn't fully loaded yet
          const ltv1 = imageData?.ltv1 ?? 0;
          const ltv2 = imageData?.ltv2 ?? 0;
          const ltm1_1 = imageData?.ltm1_1 ?? 1;
          const ltm2_2 = imageData?.ltm2_2 ?? 1;

          // Physical to Image math: Image = LTM * Phys + LTV
          x = (ltm1_1 * x) + ltv1;
          y = (ltm2_2 * y) + ltv2;

          // Scale sizes (radius, width, height) using the matrix
          const avgLtm = Math.abs(ltm1_1 + ltm2_2) / 2;
          if (radius !== undefined) radius *= avgLtm;
          if (width !== undefined) width *= Math.abs(ltm1_1);
          if (height !== undefined) height *= Math.abs(ltm2_2);
          if (rx !== undefined) rx *= Math.abs(ltm1_1);
          if (ry !== undefined) ry *= Math.abs(ltm2_2);
          if (innerR !== undefined) innerR *= avgLtm;
          if (outerR !== undefined) outerR *= avgLtm;

      } else if (format === 'fk5' || format === 'wcs') {
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

    case 'load_regions_from_string':
      try {
        if (!imageData || !imageData.width || !imageData.height) {
            return sendReply({ message_id: command.message_id, error: "Image data not ready." });
        }
        
        // Asynchronously pass DS9 text string to parser for WCS validation
        const newRegions = await parseDS9Regions(
            command.content, 
            imageData.width, 
            imageData.height, 
            pixToWorld, 
            worldToPix, 
            imageData.pixScale || null,
            {
                ltv1: imageData.ltv1 ?? 0,
                ltv2: imageData.ltv2 ?? 0,
                ltm1_1: imageData.ltm1_1 ?? 1,
                ltm2_2: imageData.ltm2_2 ?? 1
            }
        );
        
        // Append the loaded regions to the existing ones
        setRegions((prev: any[]) => [...prev, ...newRegions]); 
        ack();
      } catch (err) {
        sendReply({ message_id: command.message_id, error: "Failed to parse regions." });
      }
      break;

    case 'get_regions_string':
      try {
        if (!imageData || !imageData.width || !imageData.height) {
            return sendReply({ message_id: command.message_id, error: "Image data not ready." });
        }
        
        const format = command.format || 'image';
        const text = await serializeDS9Regions(
            regions, 
            format, 
            imageData.width, 
            imageData.height, 
            pixToWorld, 
            imageData.pixScale || null,
            {
                ltv1: imageData.ltv1 ?? 0,
                ltv2: imageData.ltv2 ?? 0,
                ltm1_1: imageData.ltm1_1 ?? 1,
                ltm2_2: imageData.ltm2_2 ?? 1
            }
        );
        
        replyData({ content: text });
      } catch (err) {
        sendReply({ message_id: command.message_id, error: "Failed to serialize regions." });
      }
      break;
    
    default:
      sendReply({ message_id: command.message_id, error: `Unknown command: ${command.action}` });
    }
  }, [processFile, colormap, setColormap, stretch, setStretch, regions, setRegions,
      imageData, pixToWorld, worldToPix]);
}