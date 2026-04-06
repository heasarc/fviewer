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
}

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height, checkWcs, pixToWorld }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null); // New Overlay Canvas
    
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('log');

    // Interactivity & Transform
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [rotation, setRotation] = useState(0);
    
    // Region & Drawing State
    const [drawMode, setDrawMode] = useState<DrawMode>('pan');
    const [regions, setRegions] = useState<Region[]>([]);
    const [draftRegion, setDraftRegion] = useState<Region | null>(null);

    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

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

    // 2. Render Regions Overlay
    useEffect(() => {
        const ctx = overlayRef.current?.getContext('2d');
        if (!ctx) return;
        
        ctx.clearRect(0, 0, width, height);
        const allRegions = draftRegion ? [...regions, draftRegion] : regions;

        allRegions.forEach(r => {
            ctx.beginPath();
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 2 / zoom; // Keep lines thin even when zoomed in
            
            if (r.type === 'box') {
                const w = r.endX - r.startX;
                const h = r.endY - r.startY;
                ctx.strokeRect(r.startX, r.startY, w, h);
            } else if (r.type === 'circle') {
                const radius = Math.sqrt(Math.pow(r.endX - r.startX, 2) + Math.pow(r.endY - r.startY, 2));
                ctx.arc(r.startX, r.startY, radius, 0, 2 * Math.PI);
                ctx.stroke();
            }
        });
    }, [regions, draftRegion, zoom, width, height]);

    // --- Mouse Handlers ---
    // --- Mouse Handlers ---
    const getCanvasCoords = (e: React.MouseEvent) => {
        // Use the base canvas since the overlay has pointerEvents: 'none'
        const canvas = canvasRef.current; 
        if (!canvas) return { x: 0, y: 0 };
        const scaleX = width / canvas.offsetWidth;
        const scaleY = height / canvas.offsetHeight;
        return { x: e.nativeEvent.offsetX * scaleX, y: e.nativeEvent.offsetY * scaleY };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        if (drawMode === 'pan') {
            dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        } else if (e.target === canvasRef.current) {
            const { x, y } = getCanvasCoords(e);
            // Default color for regions, you can change this later!
            setDraftRegion({ id: Date.now().toString(), type: drawMode, startX: x, startY: y, endX: x, endY: y, color: '#00ff00' });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // 1. Handle Panning
        if (isDragging && drawMode === 'pan') {
            setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
            return; // Skip status bar updates while panning to save performance
        }

        // 2. Handle Region Drafting
        if (isDragging && draftRegion && e.target === canvasRef.current) {
            const { x, y } = getCanvasCoords(e);
            setDraftRegion({ ...draftRegion, endX: x, endY: y });
        }

        // 3. Handle Status Bar (Pixel & WCS lookup)
        // Note: We check canvasRef.current because the overlay has pointerEvents: 'none'
        if (e.target === canvasRef.current) {
            const { x: imgX, y: imgY } = getCanvasCoords(e);
            const fitsX = Math.floor(imgX) + 1;
            const fitsY = height - Math.floor(imgY);
            
            if (fitsX < 1 || fitsX > width || fitsY < 1 || fitsY > height) return;

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
        if (draftRegion) {
            // Only save if the user actually dragged a distance
            if (Math.abs(draftRegion.endX - draftRegion.startX) > 2) {
                setRegions([...regions, draftRegion]);
            }
            setDraftRegion(null);
        }
    };

    const handleWheel = (e: React.WheelEvent) => setZoom(prev => Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50)));

    const resetView = () => {
        setZoom(1); setPan({ x: 0, y: 0 });
        setFlipX(false); setFlipY(false); setRotation(0);
    };

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Toolbar */}
            <div className="d-flex flex-wrap gap-3 mb-2 p-2 rounded align-items-center" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
                
                {/* Drawing Modes */}
                <div className="btn-group btn-group-sm shadow-sm border border-dark">
                    <button className={`btn btn-${drawMode === 'pan' ? 'primary' : 'secondary'} border-0`} onClick={() => setDrawMode('pan')} title="Pan / Pointer">
                        <i className="bi bi-arrows-move"></i>
                    </button>
                    <button className={`btn btn-${drawMode === 'circle' ? 'primary' : 'secondary'} border-0 border-start border-dark`} onClick={() => setDrawMode('circle')} title="Draw Circle">
                        <i className="bi bi-circle"></i>
                    </button>
                    <button className={`btn btn-${drawMode === 'box' ? 'primary' : 'secondary'} border-0 border-start border-dark`} onClick={() => setDrawMode('box')} title="Draw Box">
                        <i className="bi bi-square"></i>
                    </button>
                    <button className="btn btn-danger border-0 border-start border-dark" onClick={() => setRegions([])} title="Clear Regions" disabled={regions.length === 0}>
                        <i className="bi bi-trash"></i>
                    </button>
                </div>

                {/* Color & Scale */}
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

                {/* View Transforms (Restored!) */}
                <div className="input-group input-group-sm w-auto shadow-sm ms-2">
                    <span className="input-group-text border-0 bg-dark text-white">View</span>
                    <button className={`btn btn-${flipX ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipX(!flipX)} title="Flip X">
                        <i className="bi bi-symmetry-vertical"></i>
                    </button>
                    <button className={`btn btn-${flipY ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipY(!flipY)} title="Flip Y">
                        <i className="bi bi-symmetry-horizontal"></i>
                    </button>
                    <button className="btn btn-secondary border-0 border-start border-dark" onClick={() => setRotation(r => r - 90)} title="Rotate CCW">
                        <i className="bi bi-arrow-counterclockwise"></i>
                    </button>
                    <button className="btn btn-secondary border-0" onClick={() => setRotation(r => r + 90)} title="Rotate CW">
                        <i className="bi bi-arrow-clockwise"></i>
                    </button>
                    <span className="input-group-text border-0 border-start border-dark bg-secondary text-white" style={{ borderLeft: '1px solid #1e2235 !important' }}>Angle:</span>
                    <input 
                        type="number" 
                        className="form-control border-0 text-center bg-secondary text-white" 
                        style={{ width: '65px', appearance: 'textfield' }} 
                        value={rotation} 
                        onChange={(e) => setRotation(Number(e.target.value) || 0)} 
                        step="1"
                    />
                    <span className="input-group-text border-0 bg-secondary text-white">°</span>
                </div>

                {/* Zoom & Pan */}
                <div className="ms-auto d-flex gap-1 align-items-center">
                    <span className="text-muted small me-2">{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}><i className="bi bi-zoom-out"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.min(50, z * 1.2))}><i className="bi bi-zoom-in"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={resetView} title="Reset View"><i className="bi bi-arrow-repeat"></i></button>
                </div>
            </div>

            {/* Viewport */}
            <div 
                className="d-flex justify-content-center align-items-center rounded-top border overflow-hidden position-relative" 
                style={{ backgroundColor: '#000', minHeight: '600px', cursor: drawMode === 'pan' ? (isDragging ? 'grabbing' : 'grab') : 'crosshair' }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave} onMouseLeave={handleMouseUpOrLeave} onWheel={handleWheel}
            >
                {/* Transform Layer groups both canvases so they pan/zoom/rotate together */}
                <div style={{
                    position: 'relative',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}>
                    {/* Base Image */}
                    <canvas ref={canvasRef} width={width} height={height} style={{ imageRendering: 'pixelated', display: 'block' }} />
                    
                    {/* Region Overlay */}
                    <canvas ref={overlayRef} width={width} height={height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
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
                        <>
                            <span><span className="text-muted me-1">RA:</span> <strong className="text-warning">{hoverInfo.ra}</strong>°</span>
                            <span><span className="text-muted me-1">Dec:</span> <strong className="text-warning">{hoverInfo.dec}</strong>°</span>
                        </>
                    ) : (
                        <span className="text-muted fst-italic">No WCS</span>
                    )}
                </div>
            </div>
        </div>
    );
};