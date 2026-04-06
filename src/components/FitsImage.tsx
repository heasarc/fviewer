import React, { useEffect, useRef, useState, useMemo } from 'react';
import { applyStretch } from '../utils/stretches';
import { getColormapLUT } from '../utils/colormaps';

interface FitsImageProps {
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    width: number;
    height: number;
    checkWcs: () => Promise<boolean>;
    pixToWorld: (x: number, y: number) => Promise<{ ra: number, dec: number } | null>;
}

export type DrawMode = 'pan' | 'circle' | 'box';

export interface Region {
    id: string;
    type: 'circle' | 'box';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    angle: number;
}

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height, checkWcs, pixToWorld }) => {
    const viewportRef = useRef<HTMLDivElement>(null); 
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Rendering State
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('log');

    // Interactivity & Transform State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [rotation, setRotation] = useState(0);
    
    // Region & Drawing State
    const [drawMode, setDrawMode] = useState<DrawMode>('pan');
    const [regions, setRegions] = useState<Region[]>([]);
    const [draftRegion, setDraftRegion] = useState<Region | null>(null);
    
    // Selection and Drag State
    const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    
    // Tracks if we are moving the whole shape or just resizing the corner
    const [dragAction, setDragAction] = useState<{ id: string, type: 'move' | 'resize' | 'rotate' } | null>(null);
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

    // --- MATHEMATICALLY PURE COORDINATE UN-PROJECTION ---
    const getCanvasCoords = (clientX: number, clientY: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return { x: 0, y: 0 };
        
        const rect = viewport.getBoundingClientRect();
        let cx = (clientX - rect.left) - rect.width / 2;
        let cy = (clientY - rect.top) - rect.height / 2;

        cx -= pan.x; cy -= pan.y;
        cx /= zoom; cy /= zoom;
        
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
        setDragAction(null); // Drop the region/handle if we were holding it

        if (draftRegion) {
            if (Math.abs(draftRegion.endX - draftRegion.startX) > 2 || Math.abs(draftRegion.endY - draftRegion.startY) > 2) {
                setRegions([...regions, draftRegion]);
                setSelectedRegionId(draftRegion.id); // Auto-select new region
                setDrawMode('pan'); 
            }
            setDraftRegion(null);
        }
    };

    const handleWheel = (e: React.WheelEvent) => setZoom(prev => Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50)));

    const resetView = () => {
        setZoom(1); setPan({ x: 0, y: 0 });
        setFlipX(false); setFlipY(false); setRotation(0);
    };

    // --- SVG REGION RENDERER ---
    const renderRegionSVG = (r: Region, isDraft = false) => {
        const isSelected = r.id === selectedRegionId;
        const isHovered = r.id === hoveredRegionId;
        const handleSize = 10 / zoom;
        
        let shapeElement;
        let cx: number, cy: number, topEdgeY: number;

        if (r.type === 'box') {
            const minX = Math.min(r.startX, r.endX);
            const minY = Math.min(r.startY, r.endY);
            const w = Math.abs(r.endX - r.startX);
            const h = Math.abs(r.endY - r.startY);
            
            cx = (r.startX + r.endX) / 2;
            cy = (r.startY + r.endY) / 2;
            topEdgeY = minY; // Top edge of the box
            
            shapeElement = <rect x={minX} y={minY} width={w} height={h} />;
        } else {
            const radius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
            
            cx = r.startX; // True center of the circle
            cy = r.startY;
            topEdgeY = r.startY - radius; // Top edge of the circle
            
            shapeElement = <circle cx={cx} cy={cy} r={radius} />;
        }

        const handleRegionMouseDown = (e: React.MouseEvent) => {
            if (drawMode !== 'pan') return;
            e.stopPropagation(); 
            setSelectedRegionId(r.id);
            setDragAction({ id: r.id, type: 'move' }); 
            dragStart.current = getCanvasCoords(e.clientX, e.clientY);
        };

        return (
            <g key={r.id} transform={`rotate(${r.angle || 0} ${cx} ${cy})`}>
                
                {/* 1. Invisible Fat Click Target */}
                {React.cloneElement(shapeElement, {
                    style: {
                        stroke: 'rgba(255,255,255,0.01)', 
                        strokeWidth: Math.max(10, 20 / zoom), fill: 'none',
                        pointerEvents: isDraft || drawMode !== 'pan' ? 'none' : 'stroke',
                        cursor: drawMode === 'pan' ? 'move' : 'crosshair'
                    },
                    onMouseDown: handleRegionMouseDown,
                    onMouseEnter: () => setHoveredRegionId(r.id),
                    onMouseLeave: () => setHoveredRegionId(null)
                })}
                
                {/* 2. Thin Visual Outline */}
                {React.cloneElement(shapeElement, {
                    style: {
                        stroke: isHovered && drawMode === 'pan' && !isDraft ? '#fff' : r.color, 
                        strokeWidth: (isHovered && drawMode === 'pan' && !isDraft ? 4 : 2) / zoom, 
                        fill: 'none', pointerEvents: 'none',
                        transition: 'stroke 0.1s, stroke-width 0.1s'
                    }
                })}

                {/* 3. Handles (Only visible when selected) */}
                {isSelected && !isDraft && (
                    <>
                        {/* Rotation Handle (Only for boxes!) */}
                        {r.type === 'box' && (
                            <>
                                <line x1={cx} y1={topEdgeY} x2={cx} y2={topEdgeY - (25/zoom)} stroke={r.color} strokeWidth={1/zoom} pointerEvents="none" />
                                <circle 
                                    cx={cx} cy={topEdgeY - (25/zoom)} r={handleSize/2} fill={r.color} 
                                    style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                                    onMouseDown={(e) => {
                                        if (drawMode !== 'pan') return;
                                        e.stopPropagation();
                                        setDragAction({ id: r.id, type: 'rotate' });
                                        dragStart.current = getCanvasCoords(e.clientX, e.clientY);
                                    }}
                                />
                            </>
                        )}

                        {/* Resize Handle (Bottom Right Corner / Perimeter - For both shapes) */}
                        <rect 
                            x={r.endX - handleSize / 2} y={r.endY - handleSize / 2} 
                            width={handleSize} height={handleSize} 
                            fill="#fff" stroke={r.color} strokeWidth={1/zoom}
                            style={{ cursor: 'nwse-resize', pointerEvents: 'all' }}
                            onMouseDown={(e) => {
                                if (drawMode !== 'pan') return;
                                e.stopPropagation();
                                setDragAction({ id: r.id, type: 'resize' });
                                dragStart.current = getCanvasCoords(e.clientX, e.clientY);
                            }}
                        />
                    </>
                )}
            </g>
        );
    };

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Toolbar */}
            <div className="d-flex flex-wrap gap-3 mb-2 p-2 rounded align-items-center" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
                <div className="btn-group btn-group-sm shadow-sm border border-dark">
                    <button className={`btn btn-${drawMode === 'pan' ? 'primary' : 'secondary'} border-0`} onClick={() => setDrawMode('pan')}><i className="bi bi-arrows-move"></i></button>
                    <button className={`btn btn-${drawMode === 'circle' ? 'primary' : 'secondary'} border-0 border-start border-dark`} onClick={() => setDrawMode('circle')}><i className="bi bi-circle"></i></button>
                    <button className={`btn btn-${drawMode === 'box' ? 'primary' : 'secondary'} border-0 border-start border-dark`} onClick={() => setDrawMode('box')}><i className="bi bi-square"></i></button>
                    <button className="btn btn-danger border-0 border-start border-dark" onClick={() => { setRegions([]); setSelectedRegionId(null); }} disabled={regions.length === 0}><i className="bi bi-trash"></i></button>
                </div>
                
                <div className="input-group input-group-sm w-auto shadow-sm">
                    <span className="input-group-text border-0 bg-dark text-white">Color</span>
                    <select className="form-select border-0" value={colormap} onChange={e => setColormap(e.target.value)}>
                        <option value="gray">Grayscale</option><option value="heat">Heat</option><option value="cool">Cool</option><option value="plasma">Plasma</option>
                    </select>
                </div>
                <div className="input-group input-group-sm w-auto shadow-sm">
                    <span className="input-group-text border-0 bg-dark text-white">Scale</span>
                    <select className="form-select border-0" value={stretch} onChange={e => setStretch(e.target.value)}>
                        <option value="linear">Linear</option><option value="log">Log</option><option value="sqrt">Square Root</option><option value="asinh">ASINH</option>
                    </select>
                </div>

                <div className="input-group input-group-sm w-auto shadow-sm ms-2">
                    <span className="input-group-text border-0 bg-dark text-white">View</span>
                    <button className={`btn btn-${flipX ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipX(!flipX)}><i className="bi bi-symmetry-vertical"></i></button>
                    <button className={`btn btn-${flipY ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipY(!flipY)}><i className="bi bi-symmetry-horizontal"></i></button>
                    <button className="btn btn-secondary border-0 border-start border-dark" onClick={() => setRotation(r => r - 90)}><i className="bi bi-arrow-counterclockwise"></i></button>
                    <button className="btn btn-secondary border-0" onClick={() => setRotation(r => r + 90)}><i className="bi bi-arrow-clockwise"></i></button>
                    <span className="input-group-text border-0 border-start border-dark bg-secondary text-white" style={{ borderLeft: '1px solid #1e2235 !important' }}>Angle:</span>
                    <input type="number" className="form-control border-0 text-center bg-secondary text-white" style={{ width: '65px', appearance: 'textfield' }} value={rotation} onChange={(e) => setRotation(Number(e.target.value) || 0)} step="1"/>
                    <span className="input-group-text border-0 bg-secondary text-white">°</span>
                </div>

                <div className="ms-auto d-flex gap-1 align-items-center">
                    <span className="text-muted small me-2">{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}><i className="bi bi-zoom-out"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.min(50, z * 1.2))}><i className="bi bi-zoom-in"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={resetView}><i className="bi bi-arrow-repeat"></i></button>
                </div>
            </div>

            {/* Viewport Container */}
            <div 
                ref={viewportRef}
                className="d-flex justify-content-center align-items-center rounded-top border overflow-hidden position-relative" 
                style={{ 
                    backgroundColor: '#000', minHeight: '600px', 
                    cursor: drawMode === 'pan' ? (isDragging && !dragAction ? 'grabbing' : 'grab') : 'crosshair'
                }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave} onMouseLeave={handleMouseUpOrLeave} onWheel={handleWheel}
            >
                <div style={{
                    position: 'relative', width, height, flexShrink: 0,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
                    transformOrigin: 'center center',
                    transition: (isDragging && !dragAction) ? 'transform 0.1s ease-out' : 'none'
                }}>
                    <canvas ref={canvasRef} width={width} height={height} style={{ imageRendering: 'pixelated', display: 'block', width: '100%', height: '100%' }} />
                    <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}>
                        {regions.map(r => renderRegionSVG(r))}
                        {draftRegion && renderRegionSVG(draftRegion, true)}
                    </svg>
                </div>
            </div>

            {/* Status Bar */}
            <div className="d-flex justify-content-between align-items-center px-3 py-1 rounded-bottom border border-top-0 shadow-sm" style={{ backgroundColor: 'var(--fv-panel)', fontSize: '0.85rem' }}>
                <div className="d-flex gap-4">
                    <span><span className="text-muted me-1">X:</span> <strong className="text-primary">{hoverInfo.x}</strong></span>
                    <span><span className="text-muted me-1">Y:</span> <strong className="text-primary">{hoverInfo.y}</strong></span>
                    <span><span className="text-muted me-1">Value:</span> <strong className="text-primary">{hoverInfo.val !== undefined ? Number(hoverInfo.val).toPrecision(4) : '...'}</strong></span>
                </div>
                <div className="d-flex gap-4">
                    {hasWCS ? (
                        <><span><span className="text-muted me-1">RA:</span> <strong className="text-warning">{hoverInfo.ra}</strong>°</span><span><span className="text-muted me-1">Dec:</span> <strong className="text-warning">{hoverInfo.dec}</strong>°</span></>
                    ) : <span className="text-muted fst-italic">No WCS</span>}
                </div>
            </div>
        </div>
    );
};