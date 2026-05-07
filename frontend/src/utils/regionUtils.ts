// # Copyright 2026, University of Maryland, All Rights Reserved

// src/utils/regionUtils.ts
import type { PixelScale } from 'wasm-cfitsio';

export interface Region {
    id: string;
    type: 'circle' | 'box' | 'ellipse' | 'annulus';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    angle?: number;
    innerR?: number;
    isBackground?: boolean;
}

// Helper to safely parse DS9 strings, handling sexagesimal and unit suffixes
const parseDS9Arg = (val: string, index: number) => {
    let s = val.trim().toLowerCase();
    
    // 1. Handle unit suffixes for sizes and radii (index >= 2)
    if (index >= 2) {
        if (s.endsWith('"')) return parseFloat(s) / 3600; // arcsec to degrees
        if (s.endsWith("'")) return parseFloat(s) / 60;   // arcmin to degrees
        if (s.endsWith('d')) return parseFloat(s);        // degrees
        if (s.endsWith('r')) return parseFloat(s) * (180 / Math.PI); // radians to degrees
        if (s.endsWith('p') || s.endsWith('i')) return parseFloat(s); // pixels/image
    }

    // 2. Handle HMS (Hours, Minutes, Seconds) - Typically for RA
    if (s.includes('h') && s.includes('m')) {
        const match = s.match(/([+-]?\d+)h(\d+)m([0-9.]+)s?/);
        if (match) {
            const h = Math.abs(parseFloat(match[1]));
            const m = parseFloat(match[2]);
            const sec = parseFloat(match[3]);
            const sign = (s.startsWith('-') || parseFloat(match[1]) < 0) ? -1 : 1;
            // RA in HMS is multiplied by 15 to convert to standard decimal degrees
            return sign * (h + m / 60 + sec / 3600) * 15;
        }
    }

    // 3. Handle DMS (Degrees, Minutes, Seconds) - Typically for Dec
    if (s.includes('d') && s.includes('m')) {
        const match = s.match(/([+-]?\d+)d(\d+)m([0-9.]+)s?/);
        if (match) {
            const d = Math.abs(parseFloat(match[1]));
            const m = parseFloat(match[2]);
            const sec = parseFloat(match[3]);
            const sign = (s.startsWith('-') || parseFloat(match[1]) < 0) ? -1 : 1;
            return sign * (d + m / 60 + sec / 3600);
        }
    }

    // 4. Handle standard colon-separated format (e.g., 12:34:56.7)
    if (s.includes(':')) {
        const parts = s.split(':').map(Number);
        const degOrHour = Math.abs(parts[0] || 0);
        const m = parts[1] || 0;
        const sec = parts[2] || 0;
        const sign = (parts[0] < 0 || s.startsWith('-')) ? -1 : 1;
        
        let parsed = sign * (degOrHour + m / 60 + sec / 3600);
        
        // DS9 Convention: If it's the first coordinate (RA) and in colon format, 
        // it is assumed to be in hours, so we convert it to degrees.
        if (index === 0) {
            parsed *= 15; 
        }
        return parsed;
    }

    // 5. Fallback: parse pure numbers (strip any lingering unrecognized characters)
    return parseFloat(s.replace(/[^0-9.-]/g, ''));
};

export const parseDS9Regions = async (
    text: string,
    _width: number,
    height: number,
    _pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    worldToPix: (ra: number, dec: number) => Promise<{ x: number, y: number } | null>,
    pixelScale: PixelScale | null
): Promise<Region[]> => {
    const lines = text.split('\n');
    const loadedRegions: Region[] = [];
    
    let coordSystem = 'image'; 
    
    // --- se the provided pixel scale (average the absolute X and Y scales) ---
    // (WCS scales are often negative on one axis, e.g., RA decreasing as X increases)
    let pixScale = 1;
    if (pixelScale) {
        pixScale = (Math.abs(pixelScale.scaleX) + Math.abs(pixelScale.scaleY)) / 2;
    }

    // manual pixScale; commented out; since we are getting it directly from wcsliib
    // const c1 = await pixToWorld(width / 2, height / 2);
    // const c2 = await pixToWorld((width / 2) + 1, height / 2);
    // if (c1 && c2) {
    //     pixScale = Math.hypot((c2.ra - c1.ra) * Math.cos(c1.dec * Math.PI / 180), c2.dec - c1.dec);
    // }
    

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        if (['image', 'physical', 'fk5', 'fk4', 'galactic', 'icrs'].includes(line.toLowerCase())) {
            coordSystem = line.toLowerCase();
            continue;
        }

        if (!line || line.startsWith('#') || line.startsWith('global')) continue;

        let color = '#00ff00';
        const colorMatch = line.match(/color=([a-zA-Z0-9#]+)/);
        if (colorMatch) color = colorMatch[1];
        const isBackground = /#.*\bbackground\b/i.test(line);

        const typeMatch = line.match(/(?:[a-z0-9]+;)?\s*(circle|box|ellipse|annulus)\s*\(([^)]+)\)/i);
        if (!typeMatch) continue;

        const type = typeMatch[1].toLowerCase() as 'circle'|'box'|'ellipse'|'annulus';
        const args = typeMatch[2].split(',').map(parseDS9Arg);
        
        try {
            let cx = args[0], cy = args[1];
            
            if (coordSystem !== 'image' && coordSystem !== 'physical') {
                const pix = await worldToPix(cx, cy); 
                if (pix && pix.x !== undefined && pix.y !== undefined) { 
                    cx = pix.x; 
                    cy = pix.y; 
                }
            }

            // --- FIX: Convert FITS Bottom-Left origin to SVG Top-Left origin ---
            cy = height - cy; 

            const scaleFactor = (coordSystem !== 'image' && coordSystem !== 'physical') ? (1 / pixScale) : 1;

            let r: Region = { 
                id: `loaded_${Date.now()}_${i}`, type, 
                startX: cx, startY: cy, endX: cx, endY: cy, 
                color, angle: 0, isBackground 
            };
            
            if (type === 'circle') {
                const radius = args[2] * scaleFactor;
                r.endX = cx + radius; 
            } else if (type === 'box') {
                const w = args[2] * scaleFactor; const h = args[3] * scaleFactor;
                r.startX = cx - w/2; r.startY = cy - h/2;
                r.endX = cx + w/2; r.endY = cy + h/2;
                // --- FIX: Invert DS9 counter-clockwise angle to SVG clockwise angle ---
                r.angle = -(args[4] || 0);
            } else if (type === 'ellipse') {
                const rx = args[2] * scaleFactor; const ry = args[3] * scaleFactor;
                r.endX = cx + rx; r.endY = cy + ry;
                // --- FIX: Invert angle ---
                r.angle = -(args[4] || 0);
            } else if (type === 'annulus') {
                r.innerR = args[2] * scaleFactor; r.endX = cx + (args[3] * scaleFactor); 
            }

            if (isNaN(r.startX) || isNaN(r.startY) || isNaN(r.endX) || isNaN(r.endY)) continue;
            loadedRegions.push(r);
        } catch (err) {
            console.warn("Skipped unparseable region line:", line);
        }
    }
    
    return loadedRegions;
};

export const serializeDS9Regions = async (
    regions: Region[],
    format: 'image' | 'fk5',
    _width: number,
    height: number,
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    pixelScale: PixelScale | null
): Promise<string> => {
    let fileContent = "# Region file format: DS9 version 4.1\n";
    fileContent += "global color=green dashlist=8 3 width=1 font=\"helvetica 10 normal roman\" select=1 highlite=1 dash=0 fixed=0 edit=1 move=1 delete=1 include=1 source=1\n";
    // Fallback to image if we requested fk5 but have no WCS scale
    if (format === 'fk5' && !pixelScale) {
        format = 'image';
    }
    
    fileContent += `${format}\n`; 

    // --- Derive pixScale directly from WCS ---
    let pixScale = 1;
    if (format === 'fk5' && pixelScale) {
        pixScale = (Math.abs(pixelScale.scaleX) + Math.abs(pixelScale.scaleY)) / 2;
    }
    
    for (const r of regions) {
        let line = "";
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

        // ... (keep your existing width/height/cx/cy math)

        let outCx = cx;
        // --- FIX: Convert SVG Top-Left back to FITS Bottom-Left ---
        let outCy = height - cy; 
        
        // --- FIX: Revert the angle for DS9 ---
        const outAngle = -(r.angle || 0); 

        if (format === 'fk5') {
            // Note: pass outCy (the true FITS pixel Y) to pixToWorld, not the SVG cy!
            const world = await pixToWorld(outCx, outCy);
            if (world) { outCx = world.ra; outCy = world.dec; }
            w *= pixScale; h *= pixScale; radius *= pixScale;
        }

        if (r.type === 'box') {
            line = `box(${outCx.toFixed(5)},${outCy.toFixed(5)},${w.toFixed(5)},${h.toFixed(5)},${outAngle.toFixed(3)})`;
        } else if (r.type === 'ellipse') {
            line = `ellipse(${outCx.toFixed(5)},${outCy.toFixed(5)},${(w/2).toFixed(5)},${(h/2).toFixed(5)},${outAngle.toFixed(3)})`;
        } else if (r.type === 'annulus') {
            const inner = (r.innerR ?? (radius / 2)) * (format === 'fk5' ? pixScale : 1);
            line = `annulus(${outCx.toFixed(5)},${outCy.toFixed(5)},${inner.toFixed(5)},${radius.toFixed(5)})`;
        } else {
            line = `circle(${outCx.toFixed(5)},${outCy.toFixed(5)},${radius.toFixed(5)})`;
        }
        
        let props = `color=${r.color}`;
        if (r.isBackground) props += ` background`;
        fileContent += `${line} # ${props}\n`;
    }

    return fileContent;
};