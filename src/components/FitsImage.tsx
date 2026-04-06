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

    // Interactivity & Transform State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [rotation, setRotation] = useState(0);
    
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Status Bar & WCS State
    const [hasWCS, setHasWCS] = useState(false);
    const [hoverInfo, setHoverInfo] = useState({ x: 0, y: 0, val: 0, ra: 'N/A', dec: 'N/A' });
    const isWcsPending = useRef(false);

    useEffect(() => {
        checkWcs().then(setHasWCS).catch(() => setHasWCS(false));
    }, [checkWcs]);

    const { min, max } = useMemo(() => {
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

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
        // 1. Handle Panning
        if (isDragging) {
            setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
            return; // Skip WCS lookup while panning
        }

        // 2. Handle Status Bar & WCS
        // Using e.target ensures we only calculate when hovering the actual image pixels
        if (e.target === canvasRef.current) {
            const canvas = canvasRef.current;
            
            // e.nativeEvent.offsetX automatically un-transforms our CSS flips and rotations!
            // We just need to scale it in case the canvas is being shrunk by `maxWidth: 100%`.
            const scaleX = width / canvas.offsetWidth;
            const scaleY = height / canvas.offsetHeight;
            
            const imgX = e.nativeEvent.offsetX * scaleX;
            const imgY = e.nativeEvent.offsetY * scaleY;

            const fitsX = Math.floor(imgX) + 1;
            const fitsY = height - Math.floor(imgY); // FITS origin is bottom-left
            
            // Guard bounds
            if (fitsX < 1 || fitsX > width || fitsY < 1 || fitsY > height) return;

            const dataIdx = (fitsY - 1) * width + (fitsX - 1);
            const val = data[dataIdx];

            setHoverInfo(prev => ({ ...prev, x: fitsX, y: fitsY, val }));

            // Instant WCS lookup
            if (hasWCS && !isWcsPending.current) {
                isWcsPending.current = true;
                pixToWorld(fitsX, fitsY)
                    .then(coords => {
                        if (coords) setHoverInfo(prev => ({ ...prev, ra: coords.ra.toFixed(5), dec: coords.dec.toFixed(5) }));
                    })
                    .catch(err => console.error(err))
                    .finally(() => { isWcsPending.current = false; });
            }
        }
    };

    const handleMouseUpOrLeave = () => setIsDragging(false);
    const handleWheel = (e: React.WheelEvent) => setZoom(prev => Math.max(0.1, Math.min(prev * (e.deltaY < 0 ? 1.1 : 0.9), 50)));

    const resetView = () => {
        setZoom(1); setPan({ x: 0, y: 0 });
        setFlipX(false); setFlipY(false); setRotation(0);
    };

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Toolbar */}
            <div className="d-flex flex-wrap gap-3 mb-2 p-2 rounded" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
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

                {/* View Transforms */}
                <div className="input-group input-group-sm w-auto shadow-sm ms-2">
                    <span className="input-group-text border-0 bg-dark text-white">View</span>
                    
                    {/* Flips */}
                    <button className={`btn btn-${flipX ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipX(!flipX)} title="Flip X">
                        <i className="bi bi-symmetry-vertical"></i> Flip X
                    </button>
                    <button className={`btn btn-${flipY ? 'primary' : 'secondary'} border-0`} onClick={() => setFlipY(!flipY)} title="Flip Y">
                        <i className="bi bi-symmetry-horizontal"></i> Flip Y
                    </button>
                    
                    {/* Stepped Rotations */}
                    <button className="btn btn-secondary border-0 border-start border-dark" onClick={() => setRotation(r => r - 90)} title="Rotate CCW">
                        <i className="bi bi-arrow-counterclockwise"></i>
                    </button>
                    <button className="btn btn-secondary border-0" onClick={() => setRotation(r => r + 90)} title="Rotate CW">
                        <i className="bi bi-arrow-clockwise"></i>
                    </button>
                    
                    {/* Custom Rotation Input */}
                    <span className="input-group-text border-0 border-start border-dark bg-secondary text-white" style={{ borderLeft: '1px solid #1e2235 !important' }}>Angle:</span>
                    <input 
                        type="number" 
                        className="form-control border-0 text-center bg-secondary text-white" 
                        style={{ width: '65px', appearance: 'textfield' }} // hides browser increment arrows
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
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={resetView} title="Reset View"><i className="bi bi-arrows-move"></i></button>
                </div>
            </div>

            {/* Viewport */}
            <div 
                className="d-flex justify-content-center align-items-center rounded-top border overflow-hidden position-relative" 
                style={{ backgroundColor: '#000', minHeight: '600px', cursor: isDragging ? 'grabbing' : 'crosshair' }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave} onMouseLeave={handleMouseUpOrLeave} onWheel={handleWheel}
            >
                <canvas 
                    ref={canvasRef} 
                    width={width} 
                    height={height} 
                    style={{ 
                        imageRendering: 'pixelated', 
                        // GPU-accelerated CSS transformations!
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.2s ease-out'
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