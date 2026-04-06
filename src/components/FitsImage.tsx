import React, { useEffect, useRef, useState, useMemo } from 'react';
import { applyStretch } from '../utils/stretches';
import { getColormapLUT } from '../utils/colormaps';

interface FitsImageProps {
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    width: number;
    height: number;
}

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Rendering State
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('log');

    // Interactivity State
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    // Calculate Min/Max (runs once per image)
    const { min, max } = useMemo(() => {
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

    // Render Canvas (runs only when data or display settings change)
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
        if (!isDragging) return;
        setPan({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        });
    };

    const handleMouseUpOrLeave = () => {
        setIsDragging(false);
    };

    const handleWheel = (e: React.WheelEvent) => {
        // Zoom in/out with the mouse wheel
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        setZoom(prev => Math.max(0.1, Math.min(prev * zoomFactor, 50))); // clamp between 0.1x and 50x
    };

    const resetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Image Toolbar */}
            <div className="d-flex gap-3 mb-2 p-2 rounded" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
                <div className="input-group input-group-sm w-auto shadow-sm">
                    <span className="input-group-text border-0 bg-dark text-white">Color</span>
                    <select className="form-select border-0" value={colormap} onChange={e => setColormap(e.target.value)}>
                        <option value="gray">Grayscale</option>
                        <option value="heat">Heat (ds9)</option>
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
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.max(0.1, z * 0.8))} title="Zoom Out">
                        <i className="bi bi-zoom-out"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={() => setZoom(z => Math.min(50, z * 1.2))} title="Zoom In">
                        <i className="bi bi-zoom-in"></i>
                    </button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0" onClick={resetView} title="Reset View">
                        <i className="bi bi-arrows-move"></i>
                    </button>
                </div>
            </div>

            {/* Viewport Container (Handles clipping and mouse events) */}
            <div 
                className="d-flex justify-content-center align-items-center rounded border overflow-hidden position-relative shadow-sm" 
                style={{ backgroundColor: '#000', minHeight: '600px', cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
                onWheel={handleWheel}
            >
                {/* The actual Canvas (Moves and scales via CSS) */}
                <canvas 
                    ref={canvasRef} 
                    width={width} 
                    height={height} 
                    style={{ 
                        imageRendering: 'pixelated', // Keeps individual pixels crisp when zoomed in
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out' // Smooth zoom, instant drag
                    }}
                />
            </div>
        </div>
    );
};