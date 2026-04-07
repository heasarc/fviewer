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

        // 1. uPlot REQUIRES the X-axis data to be sorted ascending for performance.
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

        // 2. Dark Theme Colors
        const textColor = '#c8cfe8'; // --fv-text
        const gridColor = '#3a3f60'; // --fv-border
        const accentColor = '#7ec8e3'; // --fv-accent

        // Reusable dark-theme configuration for X and Y axes
        const axisConfig: uPlot.Axis = {
            stroke: textColor, // Label and tick text color
            grid: {
                show: true,
                stroke: gridColor, // Faint grid lines
                width: 1,
            },
            ticks: {
                show: true,
                stroke: gridColor, // Tick marks on the axis line
                width: 1,
            }
        };

        // 3. Configure uPlot
        const opts: uPlot.Options = {
            title: title || `${yLabel} vs ${xLabel}`,
            width: containerRef.current.clientWidth || 400,
            height: 350,
            cursor: { drag: { x: true, y: true } }, // Allow zooming in both directions
            axes: [
                { ...axisConfig, label: xLabel }, // X-Axis
                { ...axisConfig, label: yLabel }  // Y-Axis
            ],
            scales: {
                x: { time: false }, // FITS data is raw numbers, not UNIX timestamps
                y: { }
            },
            series: [
                {}, // X-axis (no config needed)
                {
                    label: yLabel,
                    stroke: accentColor, 
                    fill: 'rgba(126, 200, 227, 0.1)', // Faint cyan fill
                    paths: () => null, // Disable connecting lines for a true scatter plot
                    points: { 
                        show: true, 
                        size: 4, 
                        fill: accentColor, 
                        stroke: accentColor 
                    }
                }
            ]
        };

        // 4. Mount the plot
        const data: uPlot.AlignedData = [sortedX, sortedY];
        plotRef.current = new uPlot(opts, data, containerRef.current);

        // 5. Handle Window Resize dynamically
        const handleResize = () => {
            if (plotRef.current && containerRef.current) {
                plotRef.current.setSize({
                    width: containerRef.current.clientWidth,
                    height: 350
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
        // The container needs to take full width so uPlot can measure it properly
        <div className="w-100 h-100 d-flex justify-content-center align-items-center" ref={containerRef} />
    );
};