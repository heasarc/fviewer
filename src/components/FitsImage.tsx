import React, { useEffect, useRef } from 'react';

interface FitsImageProps {
    data: Float32Array | Int32Array | Int16Array | Uint8Array;
    width: number;
    height: number;
}

export const FitsImage: React.FC<FitsImageProps> = ({ data, width, height }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. Find Min/Max for basic contrast stretching
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }

        // 2. Create ImageData buffer (RGBA)
        const imgData = ctx.createImageData(width, height);
        const range = max - min || 1; // Prevent divide by zero

        // 3. Map FITS pixels to RGBA Canvas pixels (Linear grayscale)
        for (let i = 0; i < data.length; i++) {
            // FITS files are typically rendered bottom-to-top, but Canvas is top-to-bottom.
            // We flip the Y coordinate here.
            const x = i % width;
            const y = height - 1 - Math.floor(i / width);
            const idx = (y * width + x) * 4;

            // Normalize pixel to 0-255
            const val = Math.max(0, Math.min(255, Math.floor(((data[i] - min) / range) * 255)));

            imgData.data[idx] = val;     // R
            imgData.data[idx + 1] = val; // G
            imgData.data[idx + 2] = val; // B
            imgData.data[idx + 3] = 255; // Alpha
        }

        // 4. Paint to canvas
        ctx.putImageData(imgData, 0, 0);

    }, [data, width, height]);

    return (
        <div className="d-flex justify-content-center bg-dark rounded border border-secondary p-2 overflow-auto" style={{ maxHeight: '700px' }}>
            <canvas 
                ref={canvasRef} 
                width={width} 
                height={height} 
                style={{ imageRendering: 'pixelated', maxWidth: '100%', height: 'auto' }}
            />
        </div>
    );
};