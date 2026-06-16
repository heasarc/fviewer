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

export interface PhysicalTransform {
    ltv1: number;
    ltv2: number;
    ltm1_1: number;
    ltm2_2: number;
}

export type DrawMode = 'pan' | 'circle' | 'box' | 'ellipse' | 'annulus';

const DEFAULT_PHYSICAL_TRANSFORM: PhysicalTransform = { ltv1: 0, ltv2: 0, ltm1_1: 1, ltm2_2: 1 };

// Helper to safely parse DS9 strings, handling sexagesimal and unit suffixes
const parseDS9Arg = (val: string, index: number) => {
    let s = val.trim().toLowerCase();
    
    if (index >= 2) {
        if (s.endsWith('"')) return parseFloat(s) / 3600; 
        if (s.endsWith("'")) return parseFloat(s) / 60;   
        if (s.endsWith('d')) return parseFloat(s);        
        if (s.endsWith('r')) return parseFloat(s) * (180 / Math.PI); 
        if (s.endsWith('p') || s.endsWith('i')) return parseFloat(s); 
    }

    if (s.includes('h') && s.includes('m')) {
        const match = s.match(/([+-]?\d+)h(\d+)m([0-9.]+)s?/);
        if (match) {
            const h = Math.abs(parseFloat(match[1]));
            const m = parseFloat(match[2]);
            const sec = parseFloat(match[3]);
            const sign = (s.startsWith('-') || parseFloat(match[1]) < 0) ? -1 : 1;
            return sign * (h + m / 60 + sec / 3600) * 15;
        }
    }

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

    if (s.includes(':')) {
        const parts = s.split(':').map(Number);
        const degOrHour = Math.abs(parts[0] || 0);
        const m = parts[1] || 0;
        const sec = parts[2] || 0;
        const sign = (parts[0] < 0 || s.startsWith('-')) ? -1 : 1;
        
        let parsed = sign * (degOrHour + m / 60 + sec / 3600);
        if (index === 0) parsed *= 15; 
        return parsed;
    }

    return parseFloat(s.replace(/[^0-9.-]/g, ''));
};

export const parseDS9Regions = async (
    text: string,
    _width: number,
    height: number,
    _pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    worldToPix: (ra: number, dec: number) => Promise<{ x: number, y: number } | null>,
    physicalTransform: PhysicalTransform = DEFAULT_PHYSICAL_TRANSFORM
): Promise<Region[]> => {
    const lines = text.split('\n');
    const loadedRegions: Region[] = [];
    let coordSystem = 'image'; 

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
            let pxRadius = 0, pxWidth = 0, pxHeight = 0, pxInner = 0;
            
            if (coordSystem === 'physical') {
                cx = (physicalTransform.ltm1_1 * args[0]) + physicalTransform.ltv1;
                cy = (physicalTransform.ltm2_2 * args[1]) + physicalTransform.ltv2;
                pxRadius = args[2] * Math.abs(physicalTransform.ltm1_1);
                pxWidth = args[2] * Math.abs(physicalTransform.ltm1_1);
                pxHeight = args[3] * Math.abs(physicalTransform.ltm2_2);
                pxInner = args[2] * Math.abs(physicalTransform.ltm1_1);
            } else if (coordSystem !== 'image') {
                // --- WCS to Image: Use exact WCS offsets to find pixel sizes ---
                const cp = await worldToPix(args[0], args[1]);
                if (cp) {
                    cx = cp.x; cy = cp.y;
                    
                    if (type === 'circle') {
                        // Offset Dec by radius to find edge
                        const ep = await worldToPix(args[0], args[1] + args[2]);
                        if (ep) pxRadius = Math.hypot(ep.x - cp.x, ep.y - cp.y);
                    } else if (type === 'annulus') {
                        const inP = await worldToPix(args[0], args[1] + args[2]);
                        const outP = await worldToPix(args[0], args[1] + args[3]);
                        if (inP) pxInner = Math.hypot(inP.x - cp.x, inP.y - cp.y);
                        if (outP) pxRadius = Math.hypot(outP.x - cp.x, outP.y - cp.y);
                    } else {
                        // Box/Ellipse: args[2] is width/rx, args[3] is height/ry
                        const ex = await worldToPix(args[0] + (args[2] / Math.cos(args[1] * Math.PI / 180)), args[1]);
                        const ey = await worldToPix(args[0], args[1] + args[3]);
                        if (ex) pxWidth = Math.hypot(ex.x - cp.x, ex.y - cp.y);
                        if (ey) pxHeight = Math.hypot(ey.x - cp.x, ey.y - cp.y);
                    }
                }
            } else {
                // Pure Image coords
                pxRadius = args[2]; pxWidth = args[2]; pxHeight = args[3]; pxInner = args[2];
            }

            cy = height - cy; // FITS to SVG origin

            let r: Region = { 
                id: `loaded_${Date.now()}_${i}`, type, 
                startX: cx, startY: cy, endX: cx, endY: cy, 
                color, angle: 0, isBackground 
            };
            
            if (type === 'circle') {
                r.endX = cx + pxRadius; 
            } else if (type === 'box') {
                r.startX = cx - pxWidth/2; r.startY = cy - pxHeight/2;
                r.endX = cx + pxWidth/2; r.endY = cy + pxHeight/2;
                r.angle = -(args[4] || 0);
            } else if (type === 'ellipse') {
                r.endX = cx + pxWidth; r.endY = cy + pxHeight;
                r.angle = -(args[4] || 0);
            } else if (type === 'annulus') {
                r.innerR = pxInner; r.endX = cx + pxRadius; 
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
    format: 'image' | 'physical' | 'fk5',
    _width: number,
    height: number,
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    pixelScale: PixelScale | null,
    physicalTransform: PhysicalTransform = DEFAULT_PHYSICAL_TRANSFORM
): Promise<string> => {
    let fileContent = "# Region file format: DS9 version 4.1\n";
    fileContent += "global color=green dashlist=8 3 width=1 font=\"helvetica 10 normal roman\" select=1 highlite=1 dash=0 fixed=0 edit=1 move=1 delete=1 include=1 source=1\n";
    
    if (format === 'fk5' && !pixelScale) format = 'image';
    fileContent += `${format}\n`; 

    // --- Helper: Exact great-circle Haversine distance in degrees ---
    const getDegDistance = async (x1: number, y1: number, x2: number, y2: number) => {
        const p1 = await pixToWorld(x1, y1);
        const p2 = await pixToWorld(x2, y2);
        if (!p1 || !p2) return 0;
        const ra1 = p1.ra * (Math.PI / 180), dec1 = p1.dec * (Math.PI / 180);
        const ra2 = p2.ra * (Math.PI / 180), dec2 = p2.dec * (Math.PI / 180);
        const a = Math.sin((dec2 - dec1) / 2) ** 2 + Math.cos(dec1) * Math.cos(dec2) * Math.sin((ra2 - ra1) / 2) ** 2;
        return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * (180 / Math.PI);
    };
    
    for (const r of regions) {
        let line = "";
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0, inner = 0;

        if (r.type === 'box') {
            w = Math.abs(r.endX - r.startX); h = Math.abs(r.endY - r.startY);
            cx = (r.startX + r.endX) / 2; cy = (r.startY + r.endY) / 2;
        } else if (r.type === 'ellipse') {
            w = Math.abs(r.endX - r.startX) * 2; h = Math.abs(r.endY - r.startY) * 2; 
            cx = r.startX; cy = r.startY;
        } else { 
            radius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
            cx = r.startX; cy = r.startY;
            inner = r.innerR ?? (radius / 2);
        }

        let outCx = cx;
        let outCy = height - cy; // SVG to FITS
        const outAngle = -(r.angle || 0); 

        if (format === 'fk5') {
            const worldCenter = await pixToWorld(outCx, outCy);
            if (worldCenter) { outCx = worldCenter.ra; outCy = worldCenter.dec; }
            
            // --- Use exact Haversine WCS distances instead of pixScale ---
            if (r.type === 'box' || r.type === 'ellipse') {
                w = await getDegDistance(cx, cy, cx + (w/2), cy) * 2;
                h = await getDegDistance(cx, cy, cx, cy + (h/2)) * 2;
            } else {
                radius = await getDegDistance(cx, cy, cx + radius, cy);
                inner = await getDegDistance(cx, cy, cx + inner, cy);
            }
        } else if (format === 'physical') {
            outCx = (outCx - physicalTransform.ltv1) / physicalTransform.ltm1_1;
            outCy = (outCy - physicalTransform.ltv2) / physicalTransform.ltm2_2;
            w /= Math.abs(physicalTransform.ltm1_1);
            h /= Math.abs(physicalTransform.ltm2_2);
            const pScaleAvg = (Math.abs(physicalTransform.ltm1_1) + Math.abs(physicalTransform.ltm2_2)) / 2;
            radius /= pScaleAvg;
            inner /= pScaleAvg;
        }

        if (r.type === 'box') {
            line = `box(${outCx.toFixed(5)},${outCy.toFixed(5)},${w.toFixed(5)},${h.toFixed(5)},${outAngle.toFixed(3)})`;
        } else if (r.type === 'ellipse') {
            line = `ellipse(${outCx.toFixed(5)},${outCy.toFixed(5)},${(w/2).toFixed(5)},${(h/2).toFixed(5)},${outAngle.toFixed(3)})`;
        } else if (r.type === 'annulus') {
            line = `annulus(${outCx.toFixed(5)},${outCy.toFixed(5)},${inner.toFixed(5)},${radius.toFixed(5)})`;
        } else {
            line = `circle(${outCx.toFixed(5)},${outCy.toFixed(5)},${radius.toFixed(5)})`;
        }
        
        let props = ''; 
        if (r.isBackground) props += ` background`;
        fileContent += `${line} # ${props}\n`;
    }

    return fileContent;
};