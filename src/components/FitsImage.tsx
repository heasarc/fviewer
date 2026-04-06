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

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height, checkWcs, pixToWorld }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Rendering State
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('log');

    // Interactivity State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Status Bar & WCS State
    const [hasWCS, setHasWCS] = useState(false);
    const [hoverInfo, setHoverInfo] = useState({ x: 0, y: 0, val: 0, ra: 'N/A', dec: 'N/A' });
    const isWcsPending = useRef(false);

    // 1. Check for WCS on mount
    useEffect(() => {
        checkWcs().then(setHasWCS).catch(() => setHasWCS(false));
    }, [checkWcs]);

    // 2. Calculate Min/Max
    const { min, max } = useMemo(() => {
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

    // 3. Render Canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
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

            imgData.data[idx]     = lut[colorIdx];
            imgData.data[idx + 1] = lut[colorIdx + 1];
            imgData.data[idx + 2] = lut[colorIdx + 2];
            imgData.data[idx + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
    }, [data, width, height, colormap, stretch, min, max]);

    // --- Interaction Handlers ---

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // Handle Panning
        if (isDragging) {
            setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
            return;
        }

        // Handle Status Bar (Pixel & WCS lookup)
        if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            
            // Check if mouse is actually over the image, not just the black background
            if (e.clientX >= rect.left && e.clientX <= rect.right && 
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                
                // Map screen coordinates to FITS pixel coordinates (1-indexed)
                const scaleX = width / rect.width;
                const scaleY = height / rect.height;
                const imgX = (e.clientX - rect.left) * scaleX;
                const imgY = (e.clientY - rect.top) * scaleY;

                const fitsX = Math.floor(imgX) + 1;
                const fitsY = height - Math.floor(imgY); // FITS Y is inverted relative to DOM

                // Get local pixel value instantly
                const dataIdx = (fitsY - 1) * width + (fitsX - 1);
                const val = data[dataIdx];

                setHoverInfo(prev => ({ ...prev, x: fitsX, y: fitsY, val }));

                // Instant WCS lookup with a lock to prevent queue flooding
                if (hasWCS && !isWcsPending.current) {
                    isWcsPending.current = true;
                    
                    pixToWorld(fitsX, fitsY)
                        .then(coords => {
                            if (coords) {
                                setHoverInfo(prev => ({ 
                                    ...prev, 
                                    ra: coords.ra.toFixed(5), 
                                    dec: coords.dec.toFixed(5) 
                                }));
                            }
                        })
                        .catch(err => console.error(err))
                        .finally(() => {
                            isWcsPending.current = false; // Unlock for the next frame
                        });
                }
            }
        }
    };

    const handleMouseUpOrLeave = () => setIsDragging(false);
    const handleWheel = (e: React.WheelEvent) => setZoom(prev => Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50)));

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Toolbar */}
            <div className="d-flex gap-3 mb-2 p-2 rounded" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
                <div className="input-group input-group-sm w-auto shadow-sm">
                    <span className="input-group-text border-0 bg-dark text-white">Color</span>
                    <select className="form-select border-0" value={colormap} onChange={e => setColormap(e.target.value)}>
                        <option value="gray">Grayscale</option>
                        <option value="heat">Heat</option>
                        <option value="cool">Cool</option>
                        <option value="plasma">Plasma</option>
                    </select>
                </div>
                
                <div className="input-group input-group-sm w-auto shadow-sm">
                    <span className="input-group-text border-0 bg-dark text-white">Scale</span>
                    <select className="form-select border-0" value={stretch} onChange={e => setStretch(e.target.value)}>
                        <option value="linear">Linear</option>
                        <option value="log">Log</option>
                        <option value="sqrt">Square Root</option>
                        <option value="asinh">ASINH</option>
                    </select>
                </div>

                <div className="ms-auto d-flex gap-1 align-items-center">
                    <span className="text-muted small me-2">{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}><i className="bi bi-zoom-out"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.min(50, z * 1.2))}><i className="bi bi-zoom-in"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => { setZoom(1); setPan({x:0, y:0}); }}><i className="bi bi-arrows-move"></i></button>
                </div>
            </div>

            {/* Viewport */}
            <div 
                className="d-flex justify-content-center align-items-center rounded-top border overflow-hidden position-relative" 
                style={{ backgroundColor: '#000', minHeight: '600px', cursor: isDragging ? 'grabbing' : 'crosshair' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
                onWheel={handleWheel}
            >
                <canvas 
                    ref={canvasRef} 
                    width={width} 
                    height={height} 
                    style={{ 
                        imageRendering: 'pixelated', 
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                    }}
                />
            </div>

            {/* JS9-style Status Bar */}
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
                        <span className="text-muted fst-italic">No WCS found in header</span>
                    )}
                </div>
            </div>
        </div>
    );
};