import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface FitsPlotProps {
    xData: number[] | Float32Array | Int32Array | Float64Array;
    yData: number[] | Float32Array | Int32Array | Float64Array;
    xLabel: string;
    yLabel: string;
    title?: string;
}

export const FitsPlot: React.FC<FitsPlotProps> = ({ xData, yData, xLabel, yLabel, title }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        if (!xData || !yData || xData.length === 0) return;

        // 1. uPlot REQUIRES the X-axis data to be sorted ascending.
        // We zip the arrays together, sort by X, and unzip them.
        const paired = [];
        for (let i = 0; i < xData.length; i++) {
            // Ignore NaN or undefined values
            if (xData[i] != null && yData[i] != null) {
                paired.push([Number(xData[i]), Number(yData[i])]);
            }
        }
        paired.sort((a, b) => a[0] - b[0]);
        
        const sortedX = paired.map(p => p[0]);
        const sortedY = paired.map(p => p[1]);

        // 2. Configure uPlot
        const opts: uPlot.Options = {
            title: title || `${yLabel} vs ${xLabel}`,
            width: containerRef.current.clientWidth || 800,
            height: 400,
            cursor: { drag: { x: true, y: true } }, // Allow zooming in both directions
            scales: {
                x: { time: false }, // FITS data is usually raw numbers, not UNIX timestamps
                y: { }
            },
            axes: [
                { label: xLabel },
                { label: yLabel }
            ],
            series: [
                {}, // X-axis (no config needed)
                {
                    label: yLabel,
                    stroke: "blue",
                    fill: "rgba(0, 0, 255, 0.1)",
                    paths: () => null, // Disable connecting lines for a true scatter plot
                    points: { show: true, size: 4, fill: "blue", stroke: "blue" }
                }
            ]
        };

        // 3. Mount the plot
        const data: uPlot.AlignedData = [sortedX, sortedY];
        plotRef.current = new uPlot(opts, data, containerRef.current);

        // 4. Handle Window Resize
        const handleResize = () => {
            if (plotRef.current && containerRef.current) {
                plotRef.current.setSize({
                    width: containerRef.current.clientWidth,
                    height: 400
                });
            }
        };
        window.addEventListener('resize', handleResize);

        // Cleanup on unmount
        return () => {
            window.removeEventListener('resize', handleResize);
            plotRef.current?.destroy();
            plotRef.current = null;
        };
    }, [xData, yData, xLabel, yLabel, title]);

    return (
        <div className="w-100" ref={containerRef} />
    );
};