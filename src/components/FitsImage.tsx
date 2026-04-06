import React, { useEffect, useRef, useState } from 'react';

interface FitsImageProps {
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    width: number;
    height: number;
}

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // UI State for future stretch/colormap logic
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('linear');

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Note: For now, this is still the basic linear grayscale stretch.
        // We will replace this with your colormapRegistry and stretch logic next!
        let min = Infinity; let max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }

        const imgData = ctx.createImageData(width, height);
        const range = max - min || 1; 

        for (let i = 0; i < data.length; i++) {
            const x = i % width;
            const y = height - 1 - Math.floor(i / width);
            const idx = (y * width + x) * 4;

            const val = Math.max(0, Math.min(255, Math.floor(((data[i] - min) / range) * 255)));

            imgData.data[idx] = val;     
            imgData.data[idx + 1] = val; 
            imgData.data[idx + 2] = val; 
            imgData.data[idx + 3] = 255; 
        }

        ctx.putImageData(imgData, 0, 0);
    }, [data, width, height, colormap, stretch]); // Re-render when colormap/stretch changes

    return (
        <div className="d-flex flex-column w-100 h-100">
            {/* Image Toolbar */}
            <div className="d-flex gap-3 mb-2 p-2 rounded" style={{ backgroundColor: 'var(--fv-panel-hover)' }}>
                <div className="input-group input-group-sm w-auto">
                    <span className="input-group-text border-0">Color</span>
                    <select className="form-select border-0" value={colormap} onChange={e => setColormap(e.target.value)}>
                        <option value="gray">Grayscale</option>
                        <option value="plasma">Plasma</option>
                        <option value="inferno">Inferno</option>
                        <option value="viridis">Viridis</option>
                    </select>
                </div>
                
                <div className="input-group input-group-sm w-auto">
                    <span className="input-group-text border-0">Scale</span>
                    <select className="form-select border-0" value={stretch} onChange={e => setStretch(e.target.value)}>
                        <option value="linear">Linear</option>
                        <option value="log">Log</option>
                        <option value="sqrt">Square Root</option>
                        <option value="asinh">ASINH</option>
                    </select>
                </div>

                {/* Placeholder for Zoom controls */}
                <div className="ms-auto d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-zoom-out"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-zoom-in"></i></button>
                    <button className="btn btn-sm btn-outline-secondary text-light border-0"><i className="bi bi-arrows-move"></i></button>
                </div>
            </div>

            {/* Canvas Container */}
            <div className="d-flex justify-content-center bg-black rounded border p-2 overflow-hidden position-relative" style={{ minHeight: '500px' }}>
                <canvas 
                    ref={canvasRef} 
                    width={width} 
                    height={height} 
                    style={{ 
                        imageRendering: 'pixelated', 
                        maxWidth: '100%', 
                        height: 'auto',
                        objectFit: 'contain'
                    }}
                />
            </div>
        </div>
    );
};