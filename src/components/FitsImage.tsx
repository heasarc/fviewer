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
    
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('log'); // Log is usually better for raw telescope data

    // 1. Calculate Min/Max only when the raw data changes
    const { min, max } = useMemo(() => {
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < minVal) minVal = data[i];
            if (data[i] > maxVal) maxVal = data[i];
        }
        // Small safeguard against flat images (range = 0)
        if (maxVal === minVal) maxVal = minVal + 1;
        return { min: minVal, max: maxVal };
    }, [data]);

    // 2. Render the image whenever data, stretch, or colormap changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imgData = ctx.createImageData(width, height);
        const range = max - min;
        const lut = getColormapLUT(colormap);

        // High-performance rendering loop
        for (let i = 0; i < data.length; i++) {
            // Flip Y-axis (FITS is bottom-up, Canvas is top-down)
            const x = i % width;
            const y = height - 1 - Math.floor(i / width);
            const idx = (y * width + x) * 4;

            // 1. Normalize [0.0 - 1.0]
            const norm = (data[i] - min) / range;
            
            // 2. Apply Stretch [0.0 - 1.0]
            const stretched = applyStretch(norm, stretch);

            // 3. Map to Colormap LUT index [0 - 255]
            const colorIdx = Math.max(0, Math.min(255, Math.floor(stretched * 255))) * 3;

            // 4. Write RGBA
            imgData.data[idx]     = lut[colorIdx];       // R
            imgData.data[idx + 1] = lut[colorIdx + 1];   // G
            imgData.data[idx + 2] = lut[colorIdx + 2];   // B
            imgData.data[idx + 3] = 255;                 // Alpha
        }

        ctx.putImageData(imgData, 0, 0);
    }, [data, width, height, colormap, stretch, min, max]);

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

                <div className="ms-auto d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-zoom-out"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-zoom-in"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-arrows-move"></i></button>
                </div>
            </div>

            {/* Canvas Container */}
            <div 
                className="d-flex justify-content-center align-items-center rounded border overflow-hidden position-relative shadow-sm" 
                style={{ backgroundColor: '#000', minHeight: '500px' }}
            >
                <canvas 
                    ref={canvasRef} 
                    width={width} 
                    height={height} 
                    style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
            </div>
        </div>
    );
};