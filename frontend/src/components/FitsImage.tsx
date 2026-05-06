// # Copyright 2026, University of Maryland, All Rights Reserved

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { applyStretch } from '../utils/stretches';
import { getColormapLUT } from '../utils/colormaps';
import type { Region } from '../utils/regionUtils';
import { RegionShape } from './RegionOverlay';

interface FitsImageProps {
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    width: number;
    height: number;
    checkWcs: () => Promise<boolean>;
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>;
    
    // region-related
    regions: Region[];
    setRegions: React.Dispatch<React.SetStateAction<Region[]>>;
    onSaveRegions: (format: 'image' | 'fk5') => void;
    onLoadRegions: () => void;
    onRegionChange?: (region: Region | null) => void;

    colormap: string;
    setColormap: React.Dispatch<React.SetStateAction<string>>;
    stretch: string;
    setStretch: React.Dispatch<React.SetStateAction<string>>;
}

export type DrawMode = 'pan' | 'circle' | 'box' | 'ellipse' | 'annulus';


export const FitsImage: React.FC<FitsImageProps> = ({ 
        data, width, height, checkWcs, pixToWorld, regions, setRegions, 
        onSaveRegions, onLoadRegions, onRegionChange,
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
    const [drawMode, setDrawMode] = useState<DrawMode>('pan');
    const [draftRegion, setDraftRegion] = useState<Region | null>(null);
    
    // Selection and Drag State
    const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    
    // Tracks if we are moving the whole shape or just resizing the corner
    const [dragAction, setDragAction] = useState<{ id: string, type: 'move' | 'resize' | 'rotate' | 'resize-inner' } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Status Bar & WCS
    const [hasWCS, setHasWCS] = useState(false);
    const [hoverInfo, setHoverInfo] = useState({ x: 0, y: 0, val: 0, ra: 'N/A', dec: 'N/A' });
    const isWcsPending = useRef(false);
    

    useEffect(() => { checkWcs().then(setHasWCS).catch(() => setHasWCS(false)); }, [checkWcs]);

    const { min, max } = useMemo(() => {
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

    // 1. Render Base Image
    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const imgData = ctx.createImageData(width, height);
        const range = max - min;
        const lut = getColormapLUT(colormap);

        for (let i = 0; i < data.length; i++) {
            const x = i % width;
            const y = height - 1 - Math.floor(i / width);
            const idx = (y * width + x) * 4;
            const norm = (data[i] - min) / range;
            const stretched = applyStretch(norm, stretch);
            const colorIdx = Math.max(0, Math.min(255, Math.floor(stretched * 255))) * 3;

            imgData.data[idx] = lut[colorIdx]; imgData.data[idx+1] = lut[colorIdx+1];
            imgData.data[idx+2] = lut[colorIdx+2]; imgData.data[idx+3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
    }, [data, width, height, colormap, stretch, min, max]);

    // --- Native Wheel Handler (Prevents Page Scroll) ---
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const handleNativeWheel = (e: WheelEvent) => {
            e.preventDefault(); 
            setZoom(prev => {
                // TypeScript Fix: If zoom is null (hasn't auto-fitted yet), default to 1
                if (prev === null) return 1; 
                return Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50));
            });
        };
        viewport.addEventListener('wheel', handleNativeWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', handleNativeWheel);
    }, []);

    // --- REGION DELETION ---
    const deleteSelectedRegion = () => {
        if (selectedRegionId) {
            setRegions(prev => prev.filter(r => r.id !== selectedRegionId));
            setSelectedRegionId(null);
            setDragAction(null);
        }
    };

    // --- REGION CALLBACK ---
    // Ref tracks the last region sent so we don't spam the parent and cause infinite loops
    const lastSentRegionRef = useRef<string | null>(null);

    useEffect(() => {
        if (onRegionChange && !isDragging) {
            const selected = regions.find(r => r.id === selectedRegionId) || null;
            
            // To prevent infinite loops, serialize the region's position to a quick string
            // Only send it to the parent if its physical coordinates actually changed!
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
            // Ignore keystrokes if the user is typing inside an input field (like the Angle box)
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

    // --- MATHEMATICALLY PURE COORDINATE UN-PROJECTION ---
    const getCanvasCoords = (clientX: number, clientY: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return { x: 0, y: 0 };
        
        // TypeScript Fix: Safely fallback to 1 if zoom hasn't calculated yet
        const currentZoom = zoom ?? 1;
        
        const rect = viewport.getBoundingClientRect();
        let cx = (clientX - rect.left) - rect.width / 2;
        let cy = (clientY - rect.top) - rect.height / 2;

        cx -= pan.x; cy -= pan.y;
        
        // Use the safe currentZoom variable here!
        cx /= currentZoom; 
        cy /= currentZoom;
        
        const rad = -rotation * (Math.PI / 180);
        const cos = Math.cos(rad); const sin = Math.sin(rad);
        let rx = cx * cos - cy * sin;
        let ry = cx * sin + cy * cos;

        if (flipX) rx = -rx; if (flipY) ry = -ry;

        return { x: rx + width / 2, y: ry + height / 2 };
    };

    // --- MOUSE HANDLERS ---
    const handleMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        setIsDragging(true);

        if (drawMode === 'pan') {
            setSelectedRegionId(null); // Deselect any active region if we click the background
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
            
            setRegions(prev => prev.map(r => {
                if (r.id === dragAction.id) {
                    if (dragAction.type === 'move') {
                        return { ...r, startX: r.startX + dx, startY: r.startY + dy, endX: r.endX + dx, endY: r.endY + dy };
                    } 
                    else if (dragAction.type === 'rotate') {
                        // Get the true center based on the shape type
                        const cx = r.type === 'box' ? (r.startX + r.endX) / 2 : r.startX;
                        const cy = r.type === 'box' ? (r.startY + r.endY) / 2 : r.startY;
                        
                        const angleRad = Math.atan2(y - cy, x - cx);
                        return { ...r, angle: (angleRad * 180 / Math.PI) + 90 };
                    }
                    else if (dragAction.type === 'resize') {
                        // Un-rotate the mouse delta so we scale along the shape's local axes
                        const rad = -(r.angle || 0) * (Math.PI / 180);
                        const cos = Math.cos(rad);
                        const sin = Math.sin(rad);
                        const localDx = dx * cos - dy * sin;
                        const localDy = dx * sin + dy * cos;
                        return { ...r, endX: r.endX + localDx, endY: r.endY + localDy };
                    }
                    else if (dragAction.type === 'resize-inner') {
                    // Calculate the new inner radius based on mouse distance from center
                    const cx = r.type === 'box' ? (r.startX + r.endX) / 2 : r.startX;
                    const cy = r.type === 'box' ? (r.startY + r.endY) / 2 : r.startY;
                    const newInnerR = Math.max(1, Math.hypot(x - cx, y - cy));
                    return { ...r, innerR: newInnerR };
                }
                }
                return r;
            }));
            
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

        // 4. Handle Status Bar
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

    // Add this simple bridge function near where your mouse handlers are
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
                                    <i className="bi bi-folder2-open"></i> Load Regions...
                                </button>
                            </li>
                            <li>
                                <button 
                                    className="dropdown-item fv-dropdown-item" 
                                    onClick={() => onSaveRegions('image')} 
                                    disabled={regions.length === 0}
                                >
                                    <span style={{ width: '16px' }}></span>
                                    <i className="bi bi-download"></i> Save as Image
                                </button>
                            </li>
                            <li>
                                <button 
                                    className="dropdown-item fv-dropdown-item" 
                                    onClick={() => onSaveRegions('fk5')} 
                                    // Disable if no regions exist OR if the image has no WCS!
                                    disabled={regions.length === 0 || !hasWCS} 
                                >
                                    <span style={{ width: '16px' }}></span>
                                    <i className="bi bi-globe"></i> Save as WCS/FK5
                                </button>
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
                {/* Transform Menu */}
                <div className="dropdown">
                    <button className="fv-btn dropdown-toggle" data-bs-toggle="dropdown"><i className="bi bi-arrows-collapse"></i> <span className="ms-1">Transform</span></button>
                    <ul className="dropdown-menu fv-dropdown-menu shadow">
                        {/* Notice: No <span style={{ width: '16px' }}></span> here! */}
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