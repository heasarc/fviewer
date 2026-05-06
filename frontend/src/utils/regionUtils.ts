// # Copyright 2026, University of Maryland, All Rights Reserved

// src/utils/regionUtils.ts

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

// Helper to safely parse DS9 strings
const parseDS9Arg = (val: string) => {
    let s = val.trim();
    if (s.includes(':')) {
        const parts = s.split(':').map(Number);
        const sign = (parts[0] < 0 || s.startsWith('-')) ? -1 : 1;
        return sign * (Math.abs(parts[0]) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600);
    }
    return parseFloat(s.replace(/["'dpi]/gi, ''));
};

export const parseDS9Regions = async (
    text: string,
    width: number,
    height: number,
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>,
    worldToPix: (ra: number, dec: number) => Promise<{ x: number, y: number } | null>
): Promise<Region[]> => {
    const lines = text.split('\n');
    const loadedRegions: Region[] = [];
    
    let coordSystem = 'image'; 
    let pixScale = 1;

    const c1 = await pixToWorld(width / 2, height / 2);
    const c2 = await pixToWorld((width / 2) + 1, height / 2);
    if (c1 && c2) {
        pixScale = Math.hypot((c2.ra - c1.ra) * Math.cos(c1.dec * Math.PI / 180), c2.dec - c1.dec);
    }

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
                r.angle = args[4] || 0;
            } else if (type === 'ellipse') {
                const rx = args[2] * scaleFactor; const ry = args[3] * scaleFactor;
                r.endX = cx + rx; r.endY = cy + ry;
                r.angle = args[4] || 0;
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
    width: number,
    height: number,
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>
): Promise<string> => {
    let fileContent = "# Region file format: DS9 version 4.1\n";
    fileContent += "global color=green dashlist=8 3 width=1 font=\"helvetica 10 normal roman\" select=1 highlite=1 dash=0 fixed=0 edit=1 move=1 delete=1 include=1 source=1\n";
    fileContent += `${format}\n`; 

    let pixScale = 1;
    if (format === 'fk5') {
        const c1 = await pixToWorld(width / 2, height / 2);
        const c2 = await pixToWorld((width / 2) + 1, height / 2);
        if (c1 && c2) {
            pixScale = Math.hypot((c2.ra - c1.ra) * Math.cos(c1.dec * Math.PI / 180), c2.dec - c1.dec);
        } else {
            format = 'image';
        }
    }
    
    for (const r of regions) {
        let line = "";
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0;

        if (r.type === 'box') {
            w = Math.abs(r.endX - r.startX); h = Math.abs(r.endY - r.startY);
            cx = (r.startX + r.endX) / 2; cy = (r.startY + r.endY) / 2;
        } else if (r.type === 'ellipse') {
            w = Math.abs(r.endX - r.startX) * 2; h = Math.abs(r.endY - r.startY) * 2; 
            cx = r.startX; cy = r.startY;
        } else { 
            radius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
            cx = r.startX; cy = r.startY;
        }

        let outCx = cx, outCy = cy;
        if (format === 'fk5') {
            const world = await pixToWorld(cx, cy);
            if (world) { outCx = world.ra; outCy = world.dec; }
            w *= pixScale; h *= pixScale; radius *= pixScale;
        }

        if (r.type === 'box') {
            line = `box(${outCx.toFixed(5)},${outCy.toFixed(5)},${w.toFixed(5)},${h.toFixed(5)},${(r.angle || 0).toFixed(3)})`;
        } else if (r.type === 'ellipse') {
            line = `ellipse(${outCx.toFixed(5)},${outCy.toFixed(5)},${(w/2).toFixed(5)},${(h/2).toFixed(5)},${(r.angle || 0).toFixed(3)})`;
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