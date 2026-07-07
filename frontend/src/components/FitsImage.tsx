// # Copyright 2026, University of Maryland, All Rights Reserved

/**
 * @fileoverview FitsImage Component for FViewer.
 * 
 * This component provides a high-performance, hardware-accelerated image viewer.
 * It renders raw FITS pixel data to an HTML5 Canvas and uses CSS transforms 
 * (`translate`, `scale`, `rotate`) to handle panning and zooming without 
 * requiring CPU-intensive re-renders. 
 * 
 * It also overlays an SVG layer for drawing and manipulating Regions.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { applyStretch } from '../utils/stretches';
import { getColormapLUT } from '../utils/colormaps';
import { RegionShape } from './RegionOverlay';
import { useCore } from '../core/FViewerContext';
import { ExtensionSlot } from '../core/PluginManager';

/**
 * Props for the FitsImage component.
 */
interface FitsImageProps {
    /** 1D flat typed array containing the raw FITS image data. */
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    /** Width of the image in pixels (NAXIS1). */
    width: number;
    /** Height of the image in pixels (NAXIS2). */
    height: number;
}

export type DrawMode = 'pan' | 'circle' | 'box' | 'ellipse' | 'annulus';

export const FitsImage: React.FC<FitsImageProps> = ({ 
        data, width, height
    }) => {

    const { 
        colormap, stretch, fitsWorker, voWorker, regions, setRegions,
        activeDataType, tableInfo,
        setActiveRegionPixels, isPlotterOpen,
        zoom, setZoom, pan, setPan, flipX, flipY, rotation,
        drawMode, setDrawMode, draftRegion, setDraftRegion,
        selectedRegionId, setSelectedRegionId, hoveredRegionId, setHoveredRegionId,
        dragAction, setDragAction, deleteSelectedRegion, handleRegionDrag,
        selectedCatalogRow, setSelectedCatalogRow
    } = useCore();

    const { checkWcs, pixToWorld } = fitsWorker;

    const viewportRef = useRef<HTMLDivElement>(null); 
    const canvasRef = useRef<HTMLCanvasElement>(null);
            
    // Tracks if we are moving the whole shape or just resizing the corner
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Status Bar & WCS State
    const [hasWCS, setHasWCS] = useState(false);
    const [hoverInfo, setHoverInfo] = useState({ x: 0, y: 0, val: 0, ra: 'N/A', dec: 'N/A' });
    const isWcsPending = useRef(false);

    // --- CATALOG OVERLAY STATE ---
    const [catalogPoints, setCatalogPoints] = useState<{x: number, y: number, rowIndex: number}[]>([]);
    
    // Check WCS availability on load
    useEffect(() => { checkWcs().then(setHasWCS).catch(() => setHasWCS(false)); }, [checkWcs]);

    // Fast min/max calculation for scaling the image intensity
    const { min, max } = useMemo(() => {
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

    // --- EXTRACT REGION PIXELS FOR HISTOGRAM ---
    const handleRegionChange = React.useCallback((region: any | null) => {
        // We no longer need to check isPlotterOpenRef here! 
        // If they draw a region, we just calculate the pixels. The plotter will use them if it's open.
        if (!region || !data) {
            setActiveRegionPixels(null);
            return;
        }

        const pixels: number[] = [];
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0;
        
        if (region.type === 'box') {
            w = Math.abs(region.endX - region.startX);
            h = Math.abs(region.endY - region.startY);
            cx = (region.startX + region.endX) / 2;
            cy = (region.startY + region.endY) / 2;
        } else if (region.type === 'ellipse') {
            w = Math.abs(region.endX - region.startX) * 2;
            h = Math.abs(region.endY - region.startY) * 2;
            cx = region.startX;
            cy = region.startY;
        } else {
            radius = Math.hypot(region.endX - region.startX, region.endY - region.startY);
            w = radius * 2; h = radius * 2;
            cx = region.startX; cy = region.startY;
        }

        const rad = -(region.angle || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const maxR = Math.max(w/2, h/2); 
        const minX = Math.max(1, Math.floor(cx - maxR));
        const maxX = Math.min(width, Math.ceil(cx + maxR));
        const minY = Math.max(1, Math.floor(cy - maxR));
        const maxY = Math.min(height, Math.ceil(cy + maxR));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                
                const tx = x - cx; const ty = y - cy;
                const rx = tx * cos - ty * sin;
                const ry = tx * sin + ty * cos;

                let inside = false;
                if (region.type === 'box') {
                    if (Math.abs(rx) <= w/2 && Math.abs(ry) <= h/2) inside = true;
                } else if (region.type === 'ellipse') {
                    if ((rx*rx)/Math.pow(w/2, 2) + (ry*ry)/Math.pow(h/2, 2) <= 1) inside = true;
                } else if (region.type === 'annulus') {
                    const r2 = rx*rx + ry*ry;
                    const out2 = Math.pow(radius, 2);
                    const in2 = Math.pow(region.innerR || radius/2, 2);
                    if (r2 <= out2 && r2 >= in2) inside = true;
                } else { 
                    if (rx*rx + ry*ry <= Math.pow(radius, 2)) inside = true;
                }

                if (inside) {
                    const dataIdx = (height - y) * width + (x - 1);
                    pixels.push(data[dataIdx]);
                }
            }
        }
        
        setActiveRegionPixels(pixels);
    }, [data, width, height, setActiveRegionPixels]);

    /**
     * Core Render Loop
     * Iterates over the 1D FITS data array, applies the stretch algorithm,
     * maps the normalized value to the selected colormap LUT, and paints it
     * directly into the HTML5 Canvas ImageData.
     */
    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || width === 0 || height === 0) return;
        const imgData = ctx.createImageData(width, height);
        const range = max - min;
        const lut = getColormapLUT(colormap);

        for (let i = 0; i < data.length; i++) {
            const x = i % width;
            // FITS files are stored bottom-to-top, so we invert Y when rendering
            const y = height - 1 - Math.floor(i / width);
            const idx = (y * width + x) * 4;
            
            const norm = (data[i] - min) / range;
            const stretched = applyStretch(norm, stretch);
            const colorIdx = Math.max(0, Math.min(255, Math.floor(stretched * 255))) * 3;

            imgData.data[idx] = lut[colorIdx]; 
            imgData.data[idx+1] = lut[colorIdx+1];
            imgData.data[idx+2] = lut[colorIdx+2]; 
            imgData.data[idx+3] = 255; // Alpha
        }
        ctx.putImageData(imgData, 0, 0);
    }, [data, width, height, colormap, stretch, min, max]);

    /**
     * Native Wheel Handler
     * Used instead of React's `onWheel` to utilize `{ passive: false }`,
     * which allows us to `e.preventDefault()` and stop the entire browser 
     * page from scrolling while zooming.
     */
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const handleNativeWheel = (e: WheelEvent) => {
            e.preventDefault(); 
            setZoom(prev => {
                if (prev === null) return 1; 
                return Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50));
            });
        };
        viewport.addEventListener('wheel', handleNativeWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', handleNativeWheel);
    }, []);

    /**
     * REGION CALLBACK & INFINITE LOOP PREVENTION
     * When regions are dragged, React state updates rapidly. To prevent ping-ponging 
     * network requests or infinite loops with the parent component, we serialize the 
     * physical coordinates into a hash. The parent callback is only fired if the hash 
     * actually changes.
     */
    const lastSentRegionRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isDragging) {
            const selected = regions.find(r => r.id === selectedRegionId) || null;
            const regionHash = selected ? `${selected.id}-${selected.startX}-${selected.startY}-${selected.endX}-${selected.endY}-${selected.angle}-${selected.innerR}` : null;
            
            if (regionHash !== lastSentRegionRef.current) {
                lastSentRegionRef.current = regionHash;
                handleRegionChange(selected); // Call the local function!
            }
        }
    }, [regions, selectedRegionId, isDragging, handleRegionChange]);

    // Jump-start region pixel calculation when the Plotter is opened
    useEffect(() => {
        if (isPlotterOpen && data && regions.length > 0) {
            // Find the active region, or just use the last one drawn
            const selected = regions.find(r => r.id === selectedRegionId) || regions[regions.length - 1];
            handleRegionChange(selected);
        }
    }, [isPlotterOpen, data, regions, selectedRegionId, handleRegionChange]);

    // Keyboard listener for Backspace / Delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore keystrokes if the user is typing inside an input field
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegionId) {
                deleteSelectedRegion();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedRegionId]);

    // --- Auto "Fit-to-Window" Zoom ---
    useEffect(() => {
        if (!viewportRef.current || width === 0 || height === 0) return;
        
        const rect = viewportRef.current.getBoundingClientRect();
        const scaleX = rect.width / width;
        const scaleY = rect.height / height;
        
        // Take the smaller scale to ensure the whole image fits, with a 5% margin
        const fitZoom = Math.min(scaleX, scaleY) * 0.95;
        
        setZoom(fitZoom);
        setPan({ x: 0, y: 0 }); // Center the pan
    }, [width, height]);

    /*
    detects when a catalog is loaded, finds the RA and Dec columns, asks the VOTable
    worker for the full arrays, and maps them to pixels.
    */
    useEffect(() => {
        // Only run if we have an image, WCS, and a catalog is actively loaded
        if (activeDataType !== 'votable' || !tableInfo || !hasWCS) {
            setCatalogPoints([]);
            return;
        }

        const mapCatalogToPixels = async () => {
            try {
                // 1. Find the RA and Dec columns (case insensitive)
                const raColIdx = tableInfo.columns.findIndex((c: any) => c.name.toLowerCase() === 'ra');
                const decColIdx = tableInfo.columns.findIndex((c: any) => c.name.toLowerCase() === 'dec');
                
                if (raColIdx < 0 || decColIdx < 0) return;

                // 2. Fetch the flat TypedArrays from the Rust WASM cache
                const raRes = await voWorker.readColumn(raColIdx + 1, tableInfo.columns[raColIdx].name);
                const decRes = await voWorker.readColumn(decColIdx + 1, tableInfo.columns[decColIdx].name);
                
                const raData = raRes.data;
                const decData = decRes.data;
                
                // Limit to 2000 points to prevent flooding the Web Worker message queue
                // (For massive catalogs, a bulk WORLD_TO_PIX WASM function should be added later)
                const totalPoints = Math.min(raData.length, decData.length, 2000);
                const points: {x: number, y: number, rowIndex: number}[] = [];

                for (let i = 0; i < totalPoints; i++) {
                    const ra = raData[i];
                    const dec = decData[i];
                    
                    // Ignore NaN/Nulls
                    if (isNaN(ra) || isNaN(dec)) continue;

                    // WAIT: You destructured pixToWorld, but we need worldToPix!
                    // Let's use fitsWorker.worldToPix directly
                    const pxCoords = await fitsWorker.worldToPix(ra, dec);
                    
                    if (pxCoords && !isNaN(pxCoords.x) && !isNaN(pxCoords.y)) {
                        // FITS standard is 1-indexed, bottom-left origin. 
                        // Canvas/SVG is 0-indexed, top-left origin.
                        points.push({ 
                            x: pxCoords.x - 1, 
                            y: height - pxCoords.y,
                            rowIndex: i
                        });
                    }
                }
                setCatalogPoints(points);
            } catch (err) {
                console.error("Failed to map catalog overlay:", err);
            }
        };

        mapCatalogToPixels();
    }, [activeDataType, tableInfo, hasWCS, voWorker, fitsWorker, height]);

    /**
     * MATHEMATICALLY PURE COORDINATE UN-PROJECTION
     * 
     * Because the canvas relies on CSS transforms (translate, scale, rotate) 
     * for performance, mouse events return coordinates relative to the screen. 
     * This function manually reverses the affine transformations to map a screen
     * click back to an exact pixel coordinate on the original FITS image.
     */
    const getCanvasCoords = (clientX: number, clientY: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return { x: 0, y: 0 };
        
        const currentZoom = zoom ?? 1;
        const rect = viewport.getBoundingClientRect();
        
        // 1. Center the coordinates
        let cx = (clientX - rect.left) - rect.width / 2;
        let cy = (clientY - rect.top) - rect.height / 2;

        // 2. Reverse Pan and Zoom
        cx -= pan.x; 
        cy -= pan.y;
        cx /= currentZoom; 
        cy /= currentZoom;
        
        // 3. Reverse Rotation
        const rad = -rotation * (Math.PI / 180);
        const cos = Math.cos(rad); const sin = Math.sin(rad);
        let rx = cx * cos - cy * sin;
        let ry = cx * sin + cy * cos;

        // 4. Reverse Flips
        if (flipX) rx = -rx; if (flipY) ry = -ry;

        // 5. Shift back to Top-Left origin
        return { x: rx + width / 2, y: ry + height / 2 };
    };

    // --- MOUSE HANDLERS ---
    const handleMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        setIsDragging(true);

        if (drawMode === 'pan') {
            setSelectedRegionId(null); // Deselect any active region if clicking background
            dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        } else {
            setSelectedRegionId(null);
            dragStart.current = { x, y }; 
            setDraftRegion({ 
                id: Date.now().toString(), type: drawMode, 
                startX: x, startY: y, endX: x, endY: y, color: '#00ff00',
                angle: 0
            });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // 1. Handle Region Dragging, Resizing, and Rotating
        if (dragAction) {
            const { x, y } = getCanvasCoords(e.clientX, e.clientY);
            const dx = x - dragStart.current.x;
            const dy = y - dragStart.current.y;
            
            handleRegionDrag(x, y, dx, dy);
            
            dragStart.current = { x, y }; 
            return;
        }

        // 2. Handle Image Panning
        if (isDragging && drawMode === 'pan') {
            setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
            return;
        }

        // 3. Handle Region Drafting
        if (isDragging && draftRegion) {
            const { x, y } = getCanvasCoords(e.clientX, e.clientY);
            setDraftRegion({ ...draftRegion, endX: x, endY: y });
            return; 
        }

        // 4. Handle Status Bar & Async WCS Fetch
        const { x: imgX, y: imgY } = getCanvasCoords(e.clientX, e.clientY);
        const fitsX = Math.floor(imgX) + 1;
        const fitsY = height - Math.floor(imgY);
        
        if (fitsX >= 1 && fitsX <= width && fitsY >= 1 && fitsY <= height) {
            const val = data[(fitsY - 1) * width + (fitsX - 1)];
            setHoverInfo(prev => ({ ...prev, x: fitsX, y: fitsY, val }));

            if (hasWCS && !isWcsPending.current) {
                isWcsPending.current = true;
                pixToWorld(fitsX, fitsY)
                    .then(c => { if (c) setHoverInfo(prev => ({ ...prev, ra: c.ra.toFixed(5), dec: c.dec.toFixed(5) })); })
                    .catch(() => {})
                    .finally(() => { isWcsPending.current = false; });
            }
        }
    };

    const handleMouseUpOrLeave = () => {
        setIsDragging(false);
        setDragAction(null);

        if (draftRegion) {
            if (Math.abs(draftRegion.endX - draftRegion.startX) > 2 || Math.abs(draftRegion.endY - draftRegion.startY) > 2) {
                const newRegion = { ...draftRegion };
                
                // Set default inner radius for newly drawn annuli
                if (newRegion.type === 'annulus') {
                    const outerRadius = Math.hypot(newRegion.endX - newRegion.startX, newRegion.endY - newRegion.startY);
                    newRegion.innerR = outerRadius * 0.5;
                }

                setRegions([...regions, newRegion]);
                setSelectedRegionId(newRegion.id); 
                setDrawMode('pan'); 
            }
            setDraftRegion(null);
        }
    };

    // Bridge function routed to the child Region overlays
    const handleRegionAction = (id: string, type: 'move' | 'rotate' | 'resize' | 'resize-inner', e: React.MouseEvent) => {
        if (drawMode !== 'pan') return;
        setSelectedRegionId(id);
        setDragAction({ id, type }); 
        dragStart.current = getCanvasCoords(e.clientX, e.clientY);
    };

    return (
        <div className="d-flex flex-column w-100 h-100 border rounded overflow-hidden" style={{ borderColor: 'var(--fv-border)' }}>
            
            {/* Compact Snapshot-Style Toolbar */}
            <div className="fv-toolbar d-flex flex-wrap gap-2 align-items-center">
                
                {/* PLUGINS (Regions, Draw Tools) GO HERE */}
                <ExtensionSlot name="fitsimage:toolbar:left" />

                {/* PLUGINS (Color, Scale, Transform, etc) GO HERE */}
                <ExtensionSlot name="fitsimage:toolbar" />

                {/* RIGHT-ALIGNED PLUGINS (Zoom) GO HERE */}
                <div className="ms-auto d-flex gap-1 align-items-center">
                    <ExtensionSlot name="fitsimage:toolbar:right" />
                </div>

            </div>

            {/* Viewport */}
            <div 
                ref={viewportRef}
                className="flex-grow-1 position-relative overflow-hidden d-flex justify-content-center align-items-center" 
                style={{ backgroundColor: '#000', cursor: drawMode === 'pan' ? (isDragging ? 'grabbing' : 'grab') : 'crosshair' }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave} onMouseLeave={handleMouseUpOrLeave}
            >
                {/* ONLY RENDER IF ZOOM IS READY */}
                {zoom !== null && (
                    <div style={{
                        position: 'relative', width, height, flexShrink: 0,
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
                        transformOrigin: 'center center',
                    }}>
                        <canvas ref={canvasRef} width={width} height={height} style={{ imageRendering: 'pixelated', display: 'block', width: '100%', height: '100%' }} />
        
                        <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}>
                            {/* --- CATALOG OVERLAY --- */}
                            {catalogPoints.map((pt) => {
                                const isSelected = selectedCatalogRow === pt.rowIndex;
                                return (
                                    <circle 
                                        key={`cat-${pt.rowIndex}`} 
                                        cx={pt.x} 
                                        cy={pt.y} 
                                        r={isSelected ? 8 / (zoom || 1) : 5 / (zoom || 1)} 
                                        stroke={isSelected ? "#00ff00" : "#ffaa00"} 
                                        fill={isSelected ? "rgba(0,255,0,0.3)" : "transparent"} 
                                        strokeWidth={isSelected ? 3 / (zoom || 1) : 1.5 / (zoom || 1)} 
                                        opacity={0.8}
                                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                                        onClick={(e) => {
                                            e.stopPropagation(); // Don't trigger a pan/region draw
                                            setSelectedCatalogRow(pt.rowIndex);
                                        }}
                                    />
                                );
                            })}

                            {/* --- USER DRAWN REGIONS --- */}
                            {regions.map(r => (
                                <RegionShape 
                                    key={r.id} region={r} zoom={zoom} drawMode={drawMode}
                                    isSelected={r.id === selectedRegionId}
                                    isHovered={r.id === hoveredRegionId}
                                    onAction={handleRegionAction}
                                    onHover={setHoveredRegionId}
                                />
                            ))}
                            {draftRegion && (
                                <RegionShape 
                                    region={draftRegion} isDraft zoom={zoom} drawMode={drawMode}
                                    isSelected={false} isHovered={false}
                                    onAction={handleRegionAction} onHover={() => {}}
                                />
                            )}
                        </svg>
                    </div>
                )}
            </div>

            {/* Compact Status Bar */}
            <div className="fv-statusbar d-flex justify-content-between align-items-center">
                <div className="d-flex gap-4" style={{ fontFamily: 'monospace' }}>
                    <span><span className="fv-text-muted">X:</span> <strong style={{ color: 'var(--fv-accent)' }}>{hoverInfo.x}</strong></span>
                    <span><span className="fv-text-muted">Y:</span> <strong style={{ color: 'var(--fv-accent)' }}>{hoverInfo.y}</strong></span>
                    <span><span className="fv-text-muted">Val:</span> <strong style={{ color: 'var(--fv-accent)' }}>{hoverInfo.val !== undefined ? Number(hoverInfo.val).toPrecision(4) : '...'}</strong></span>
                </div>
                <div className="d-flex gap-4" style={{ fontFamily: 'monospace' }}>
                    {hasWCS ? (
                        <>
                            <span><span className="fv-text-muted">RA:</span> <strong className="text-warning">{hoverInfo.ra}</strong>°</span>
                            <span><span className="fv-text-muted">Dec:</span> <strong className="text-warning">{hoverInfo.dec}</strong>°</span>
                        </>
                    ) : <span className="fv-text-muted fst-italic">No WCS</span>}
                </div>
            </div>
        </div>
    );
};