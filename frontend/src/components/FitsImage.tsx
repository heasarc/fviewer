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
import type { Region } from '../utils/regionUtils';
import { RegionShape } from './RegionOverlay';
import { useRegions } from '../hooks/useRegions';

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
    /** Whether the viewer is connected to the Python backend server. */
    isConnected: boolean;
    
    // WCS callbacks routed to the Web Worker
    checkWcs: () => Promise<boolean>;
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>;
    
    // Region State Management
    regions: Region[];
    setRegions: React.Dispatch<React.SetStateAction<Region[]>>;
    onSaveRegions: (format: 'image' | 'physical' | 'fk5') => void;
    onLoadRegions: () => void;
    onLoadServerRegions: () => void;
    /** Callback fired when a region's coordinates change (debounced/hashed). */
    onRegionChange?: (region: Region | null) => void;

    // Visual Controls
    colormap: string;
    setColormap: React.Dispatch<React.SetStateAction<string>>;
    stretch: string;
    setStretch: React.Dispatch<React.SetStateAction<string>>;
}

export type DrawMode = 'pan' | 'circle' | 'box' | 'ellipse' | 'annulus';

export const FitsImage: React.FC<FitsImageProps> = ({ 
        data, width, height, isConnected, checkWcs, pixToWorld, regions, setRegions, 
        onSaveRegions, onLoadRegions, onLoadServerRegions, onRegionChange,
        colormap, setColormap, stretch, setStretch
    }) => {
    const viewportRef = useRef<HTMLDivElement>(null); 
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Interactivity & Transform State
    const [zoom, setZoom] = useState<number | null>(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [rotation, setRotation] = useState(0);
    
    // Region & Drawing State
    const {
        drawMode, setDrawMode,
        draftRegion, setDraftRegion,
        selectedRegionId, setSelectedRegionId,
        hoveredRegionId, setHoveredRegionId,
        dragAction, setDragAction,
        deleteSelectedRegion,
        handleRegionDrag
    } = useRegions(setRegions);
    const [saveFormat, setSaveFormat] = useState<'image' | 'physical' | 'fk5'>('image');
        
    // Tracks if we are moving the whole shape or just resizing the corner
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Status Bar & WCS State
    const [hasWCS, setHasWCS] = useState(false);
    const [hoverInfo, setHoverInfo] = useState({ x: 0, y: 0, val: 0, ra: 'N/A', dec: 'N/A' });
    const isWcsPending = useRef(false);
    
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

    /**
     * Core Render Loop
     * Iterates over the 1D FITS data array, applies the stretch algorithm,
     * maps the normalized value to the selected colormap LUT, and paints it
     * directly into the HTML5 Canvas ImageData.
     */
    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
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
        if (onRegionChange && !isDragging) {
            const selected = regions.find(r => r.id === selectedRegionId) || null;
            
            const regionHash = selected 
                ? `${selected.id}-${selected.startX}-${selected.startY}-${selected.endX}-${selected.endY}-${selected.angle}-${selected.innerR}` 
                : null;
            
            if (regionHash !== lastSentRegionRef.current) {
                lastSentRegionRef.current = regionHash;
                onRegionChange(selected);
            }
        }
    }, [regions, selectedRegionId, isDragging, onRegionChange]);

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

    const resetView = () => {
        setZoom(1); setPan({ x: 0, y: 0 });
        setFlipX(false); setFlipY(false); setRotation(0);
    };

    const selectedRegion = regions.find(r => r.id === selectedRegionId);

    return (
        <div className="d-flex flex-column w-100 h-100 border rounded overflow-hidden" style={{ borderColor: 'var(--fv-border)' }}>
            
            {/* Compact Snapshot-Style Toolbar */}
            <div className="fv-toolbar d-flex flex-wrap gap-2 align-items-center">
                
                {/* Regions Menu */}
                <div className="d-flex gap-1 me-2 align-items-center">
                    <div className="dropdown">
                        <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Regions Menu">
                            <i className="bi bi-bounding-box"></i> <span className="ms-1">Regions</span>
                        </button>
                        <ul className="dropdown-menu fv-dropdown-menu shadow">
                            {/* Drawing Tools */}
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('pan')}>
                                    <span style={{ width: '16px' }}>{drawMode === 'pan' && <i className="bi bi-check2"></i>}</span>
                                    <i className="bi bi-arrows-move"></i> Pointer / Pan
                                </button>
                            </li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('circle')}>
                                    <span style={{ width: '16px' }}>{drawMode === 'circle' && <i className="bi bi-check2"></i>}</span>
                                    <i className="bi bi-circle"></i> Circle
                                </button>
                            </li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('box')}>
                                    <span style={{ width: '16px' }}>{drawMode === 'box' && <i className="bi bi-check2"></i>}</span>
                                    <i className="bi bi-square"></i> Box
                                </button>
                            </li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('ellipse')}>
                                    <span style={{ width: '16px' }}>{drawMode === 'ellipse' && <i className="bi bi-check2"></i>}</span>
                                    <span style={{ transform: 'scaleY(0.7)', display: 'inline-block' }}><i className="bi bi-circle"></i></span> Ellipse
                                </button>
                            </li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setDrawMode('annulus')}>
                                    <span style={{ width: '16px' }}>{drawMode === 'annulus' && <i className="bi bi-check2"></i>}</span>
                                    <i className="bi bi-bullseye"></i> Annulus
                                </button>
                            </li>

                            {/* Region Properties */}
                            <li><hr className="dropdown-divider border-secondary my-1" /></li>
                            <li>
                                <button 
                                    className="dropdown-item fv-dropdown-item" 
                                    onClick={() => {
                                        if (selectedRegionId) {
                                            setRegions(prev => prev.map(r => 
                                                r.id === selectedRegionId ? { ...r, isBackground: !r.isBackground } : r
                                            ));
                                        }
                                    }} 
                                    disabled={!selectedRegionId}
                                >
                                    <span style={{ width: '16px' }}>
                                        {selectedRegion?.isBackground && <i className="bi bi-check2"></i>}
                                    </span>
                                    <i className="bi bi-dash-circle-dotted"></i> Set as Background
                                </button>
                            </li>

                            {/* Separator */}
                            <li><hr className="dropdown-divider border-secondary my-1" /></li>

                            {/* Deletion Actions */}
                            <li>
                                <button 
                                    className={`dropdown-item fv-dropdown-item ${selectedRegionId ? 'text-warning' : ''}`} 
                                    onClick={deleteSelectedRegion} 
                                    disabled={!selectedRegionId}
                                >
                                    <span style={{ width: '16px' }}></span>
                                    <i className="bi bi-eraser"></i> Delete Selected (Del)
                                </button>
                            </li>
                            <li>
                                <button 
                                    className={`dropdown-item fv-dropdown-item ${regions.length > 0 ? 'text-danger' : ''}`} 
                                    onClick={() => { setRegions([]); setSelectedRegionId(null); }} 
                                    disabled={regions.length === 0}
                                >
                                    <span style={{ width: '16px' }}></span>
                                    <i className="bi bi-trash"></i> Clear All Regions
                                </button>
                            </li>
                            
                            {/* File Actions */}
                            <li><hr className="dropdown-divider border-secondary my-1" /></li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={onLoadRegions}>
                                    <span style={{ width: '16px' }}></span>
                                    <i className="bi bi-folder2-open"></i> Load Local Regions...
                                </button>
                            </li>
                            {isConnected && (                                    
                                <li>
                                    <button className="dropdown-item fv-dropdown-item" onClick={onLoadServerRegions}>
                                        <span style={{ width: '16px' }}></span>
                                        <i className="bi bi-cloud-arrow-down"></i> Load Server Regions...
                                    </button>
                                </li>
                            )}
                            
                            <li><hr className="dropdown-divider border-secondary my-1" /></li>
                            
                            {/* COMPACT SAVE UI */}
                            <li className="px-3 py-1">
                                <label className="fv-text-muted mb-1" style={{ fontSize: '0.75rem' }}>Save Regions</label>
                                <div className="input-group input-group-sm">
                                    <select 
                                        className="form-select border-secondary bg-dark text-white" 
                                        value={saveFormat}
                                        onChange={(e) => setSaveFormat(e.target.value as any)}
                                        style={{ boxShadow: 'none' }}
                                        disabled={regions.length === 0}
                                    >
                                        <option value="image" title="Current image pixel coordinates">Image</option>
                                        <option value="physical" title="Original unbinned/uncropped coordinates">Physical</option>
                                        <option value="fk5" disabled={!hasWCS} title="World Coordinate System (RA/Dec)">FK5</option>
                                    </select>
                                    <button 
                                        className="btn btn-outline-secondary" 
                                        onClick={() => onSaveRegions(saveFormat)} 
                                        disabled={regions.length === 0 || (saveFormat === 'fk5' && !hasWCS)}
                                        title="Download .reg file"
                                    >
                                        <i className="bi bi-download"></i> Save
                                    </button>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
                
                {/* Color Menu */}
                <div className="dropdown">
                    <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Colormap">
                        <i className="bi bi-palette"></i> <span className="ms-1">Color</span>
                    </button>
                    <ul className="dropdown-menu fv-dropdown-menu shadow">
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('gray')}>
                                <span style={{ width: '16px' }}>{colormap === 'gray' && <i className="bi bi-check2"></i>}</span>
                                Grayscale
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('heat')}>
                                <span style={{ width: '16px' }}>{colormap === 'heat' && <i className="bi bi-check2"></i>}</span>
                                Heat
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('cool')}>
                                <span style={{ width: '16px' }}>{colormap === 'cool' && <i className="bi bi-check2"></i>}</span>
                                Cool
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setColormap('plasma')}>
                                <span style={{ width: '16px' }}>{colormap === 'plasma' && <i className="bi bi-check2"></i>}</span>
                                Plasma
                            </button>
                        </li>
                    </ul>
                </div>

                {/* Scale Menu */}
                <div className="dropdown">
                    <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Scale / Stretch">
                        <i className="bi bi-graph-up"></i> <span className="ms-1">Scale</span>
                    </button>
                    <ul className="dropdown-menu fv-dropdown-menu shadow">
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('linear')}>
                                <span style={{ width: '16px' }}>{stretch === 'linear' && <i className="bi bi-check2"></i>}</span>
                                Linear
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('log')}>
                                <span style={{ width: '16px' }}>{stretch === 'log' && <i className="bi bi-check2"></i>}</span>
                                Log
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('sqrt')}>
                                <span style={{ width: '16px' }}>{stretch === 'sqrt' && <i className="bi bi-check2"></i>}</span>
                                Square Root
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setStretch('asinh')}>
                                <span style={{ width: '16px' }}>{stretch === 'asinh' && <i className="bi bi-check2"></i>}</span>
                                ASINH
                            </button>
                        </li>
                    </ul>
                </div>

                {/* Transform Menu */}
                <div className="dropdown">
                    <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown"><i className="bi bi-arrows-collapse"></i> <span className="ms-1">Transform</span></button>
                    <ul className="dropdown-menu fv-dropdown-menu shadow">
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setFlipX(!flipX)}>
                                <i className="bi bi-symmetry-vertical"></i> Flip X
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setFlipY(!flipY)}>
                                <i className="bi bi-symmetry-horizontal"></i> Flip Y
                            </button>
                        </li>
                        <li><hr className="dropdown-divider border-secondary my-1" /></li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setRotation(r => r - 90)}>
                                <i className="bi bi-arrow-counterclockwise"></i> Rotate CCW (90°)
                            </button>
                        </li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => setRotation(r => r + 90)}>
                                <i className="bi bi-arrow-clockwise"></i> Rotate CW (90°)
                            </button>
                        </li>
                        <li><hr className="dropdown-divider border-secondary my-1" /></li>
                        <li className="px-3 py-1">
                            <label className="fv-text-muted mb-1" style={{ fontSize: '0.75rem' }}>Custom Angle (°)</label>
                            <input type="number" className="form-control form-control-sm border-secondary bg-dark text-white" style={{ appearance: 'textfield' }} value={rotation} onChange={(e) => setRotation(Number(e.target.value) || 0)} step="1"/>
                        </li>
                    </ul>
                </div>

                {/* Zoom Menu */}
                <div className="ms-auto d-flex gap-1 align-items-center">
                    <div className="dropdown">
                        <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown" title="Zoom Menu">
                            <i className="bi bi-zoom-in"></i> <span className="ms-1">Zoom ({zoom !== null ? Math.round(zoom * 100) : 0}%)</span>
                        </button>
                        <ul className="dropdown-menu dropdown-menu-end fv-dropdown-menu shadow">
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setZoom(z => Math.min(50, (z ?? 1) * 1.2))}>
                                    <span style={{ width: '16px' }}></span><i className="bi bi-zoom-in"></i> Zoom In
                                </button>
                            </li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={() => setZoom(z => Math.max(0.1, (z ?? 1) * 0.8))}>
                                    <span style={{ width: '16px' }}></span><i className="bi bi-zoom-out"></i> Zoom Out
                                </button>
                            </li>
                            <li><hr className="dropdown-divider border-secondary my-1" /></li>
                            <li>
                                <button className="dropdown-item fv-dropdown-item" onClick={resetView}>
                                    <span style={{ width: '16px' }}></span><i className="bi bi-arrow-repeat"></i> Reset View
                                </button>
                            </li>
                        </ul>
                    </div>
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