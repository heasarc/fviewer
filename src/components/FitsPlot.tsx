import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface FitsPlotProps {
    xData: number[] | Float32Array | Int32Array | Float64Array;
    yData?: number[] | Float32Array | Int32Array | Float64Array; // Now optional for histograms
    xLabel: string;
    yLabel?: string;
    title?: string;
    plotType?: 'scatter' | 'histogram';
    numBins?: number;
}

export const FitsPlot: React.FC<FitsPlotProps> = ({ 
    xData, yData, xLabel, yLabel, title, 
    plotType = 'scatter', numBins = 50 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        if (!containerRef.current || !xData || xData.length === 0) return;

        let finalX: number[] = [];
        let finalY: number[] = [];
        let actualYLabel = yLabel || 'Counts';

        if (plotType === 'histogram') {
            // --- HISTOGRAM MATH ---
            let min = Infinity; let max = -Infinity;
            const valid = [];
            for (let i = 0; i < xData.length; i++) {
                const v = Number(xData[i]);
                if (!isNaN(v)) {
                    valid.push(v);
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }

            if (valid.length > 0) {
                if (min === max) { min -= 1; max += 1; }
                const binWidth = (max - min) / numBins;
                const counts = new Array(numBins).fill(0);
                const bins = new Array(numBins);

                for (let i = 0; i < valid.length; i++) {
                    let idx = Math.floor((valid[i] - min) / binWidth);
                    if (idx >= numBins) idx = numBins - 1; // inclusive of max bounds
                    counts[idx]++;
                }

                for (let i = 0; i < numBins; i++) {
                    bins[i] = min + (i + 0.5) * binWidth; // Bin centers
                }

                // Pad with 0s at the edges so the stepped fill drops cleanly to the axis
                finalX = [min - binWidth/2, ...bins, max + binWidth/2];
                finalY = [0, ...counts, 0];
                actualYLabel = 'Count';
            }
        } 
        else {
            // --- SCATTER PLOT MATH ---
            if (!yData) return;
            const paired = [];
            for (let i = 0; i < xData.length; i++) {
                if (xData[i] != null && yData[i] != null) {
                    paired.push([Number(xData[i]), Number(yData[i])]);
                }
            }
            // uPlot REQUIRES the X-axis data to be sorted ascending
            paired.sort((a, b) => a[0] - b[0]);
            finalX = paired.map(p => p[0]);
            finalY = paired.map(p => p[1]);
        }

        if (finalX.length === 0) return;

        // --- DARK THEME STYLING ---
        const textColor = '#c8cfe8'; // --fv-text
        const gridColor = '#3a3f60'; // --fv-border
        const accentColor = '#7ec8e3'; // --fv-accent

        const axisConfig: uPlot.Axis = {
            stroke: textColor,
            grid: { show: true, stroke: gridColor, width: 1 },
            ticks: { show: true, stroke: gridColor, width: 1 }
        };

        // --- UPLOT CONFIGURATION ---
        const opts: uPlot.Options = {
            title: title || (plotType === 'histogram' ? `${xLabel} Distribution` : `${actualYLabel} vs ${xLabel}`),
            width: containerRef.current.clientWidth || 400,
            height: 350,
            cursor: { drag: { x: true, y: true } },
            axes: [
                { ...axisConfig, label: xLabel },
                { ...axisConfig, label: actualYLabel }
            ],
            scales: { x: { time: false }, y: { } },
            series: [
                {}, 
                {
                    label: actualYLabel,
                    stroke: accentColor, 
                    fill: 'rgba(126, 200, 227, 0.15)', // Faint cyan fill
                    // If histogram, use stepped path. If scatter, disable paths.
                    paths: plotType === 'histogram' ? uPlot.paths.stepped!({ align: 1 }) : () => null,
                    // If histogram, hide dots. If scatter, show dots.
                    points: { show: plotType === 'scatter', size: 4, fill: accentColor, stroke: accentColor }
                }
            ]
        };

        const data: uPlot.AlignedData = [finalX, finalY];
        plotRef.current = new uPlot(opts, data, containerRef.current);

        const handleResize = () => {
            if (plotRef.current && containerRef.current) {
                plotRef.current.setSize({ width: containerRef.current.clientWidth, height: 350 });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            plotRef.current?.destroy();
            plotRef.current = null;
        };
    }, [xData, yData, xLabel, yLabel, title, plotType, numBins]);

    return (
        <div className="w-100 h-100 d-flex justify-content-center align-items-center" ref={containerRef} />
    );
};