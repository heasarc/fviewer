import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface FitsPlotProps {
    xData: number[] | Float32Array | Int32Array | Float64Array;
    yData?: number[] | Float32Array | Int32Array | Float64Array;
    xErrData?: number[] | Float32Array | Int32Array | Float64Array;
    yErrData?: number[] | Float32Array | Int32Array | Float64Array;
    xLabel: string;
    yLabel?: string;
    title?: string;
    plotType?: 'scatter' | 'histogram';
    numBins?: number;
}

export const FitsPlot: React.FC<FitsPlotProps> = ({ 
    xData, yData, xErrData, yErrData, xLabel, yLabel, title, 
    plotType = 'scatter', numBins = 50 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const plotRef = useRef<uPlot | null>(null);

    useEffect(() => {
        if (!containerRef.current || !xData || xData.length === 0) return;

        let finalX: number[] = [];
        let finalY: number[] = [];
        let finalXErr: number[] | null = null;
        let finalYErr: number[] | null = null;
        let actualYLabel = yLabel || 'Counts';
        
        const hasYErr = plotType === 'scatter' && yErrData && yErrData.length === xData.length;
        const hasXErr = plotType === 'scatter' && xErrData && xErrData.length === xData.length;

        const yErrIdx = hasYErr ? 2 : -1;
        const xErrIdx = hasXErr ? (hasYErr ? 3 : 2) : -1;

        // --- CUSTOM UPLOT 2D ERROR BAR BUILDER ---
        const errorBarBuilder = (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
            uPlot.orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
                const ctx = u.ctx;
                ctx.lineWidth = 1;
                ctx.strokeStyle = series.stroke as string;
                ctx.beginPath();

                const yErr = yErrIdx > -1 ? u.data[yErrIdx] : null;
                const xErr = xErrIdx > -1 ? u.data[xErrIdx] : null;

                for (let i = idx0; i <= idx1; i++) {
                    if (dataY[i] == null) continue;
                    const cx = Math.round(valToPosX(dataX[i], scaleX, xDim, xOff));
                    const cy = Math.round(valToPosY(dataY[i], scaleY, yDim, yOff));

                    if (yErr && yErr[i] != null) {
                        const yMin = Math.round(valToPosY(dataY[i] - yErr[i], scaleY, yDim, yOff));
                        const yMax = Math.round(valToPosY(dataY[i] + yErr[i], scaleY, yDim, yOff));
                        ctx.moveTo(cx, yMin); ctx.lineTo(cx, yMax);
                        ctx.moveTo(cx - 3, yMin); ctx.lineTo(cx + 3, yMin); 
                        ctx.moveTo(cx - 3, yMax); ctx.lineTo(cx + 3, yMax); 
                    }

                    if (xErr && xErr[i] != null) {
                        const xMin = Math.round(valToPosX(dataX[i] - xErr[i], scaleX, xDim, xOff));
                        const xMax = Math.round(valToPosX(dataX[i] + xErr[i], scaleX, xDim, xOff));
                        ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy);
                        ctx.moveTo(xMin, cy - 3); ctx.lineTo(xMin, cy + 3); 
                        ctx.moveTo(xMax, cy - 3); ctx.lineTo(xMax, cy + 3); 
                    }
                }
                ctx.stroke();
            });
            return null; 
        };

        // --- MATH & DATA PREPARATION ---
        if (plotType === 'histogram') {
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
                    if (idx >= numBins) idx = numBins - 1;
                    counts[idx]++;
                }
                for (let i = 0; i < numBins; i++) bins[i] = min + (i + 0.5) * binWidth;

                finalX = [min - binWidth/2, ...bins, max + binWidth/2];
                finalY = [0, ...counts, 0];
                actualYLabel = 'Count';
            }
        } 
        else {
            if (!yData) return;
            const paired = [];
            for (let i = 0; i < xData.length; i++) {
                if (xData[i] != null && yData[i] != null) {
                    paired.push([
                        Number(xData[i]), 
                        Number(yData[i]), 
                        hasYErr ? Number(yErrData![i]) : 0, 
                        hasXErr ? Number(xErrData![i]) : 0
                    ]);
                }
            }
            paired.sort((a, b) => a[0] - b[0]);
            finalX = paired.map(p => p[0]);
            finalY = paired.map(p => p[1]);
            if (hasYErr) finalYErr = paired.map(p => p[2]);
            if (hasXErr) finalXErr = paired.map(p => p[3]);
        }

        if (finalX.length === 0) return;

        // --- DARK THEME STYLING ---
        const textColor = '#c8cfe8'; 
        const gridColor = '#3a3f60'; 
        const accentColor = '#7ec8e3'; 

        const axisConfig: uPlot.Axis = { stroke: textColor, grid: { show: true, stroke: gridColor, width: 1 }, ticks: { show: true, stroke: gridColor, width: 1 } };

        const seriesList: uPlot.Series[] = [
            {}, // X-axis
            {
                label: actualYLabel, stroke: accentColor, fill: 'rgba(126, 200, 227, 0.15)',
                paths: plotType === 'histogram' ? uPlot.paths.stepped!({ align: 1 }) : (hasYErr || hasXErr ? errorBarBuilder : () => null),
                points: { show: plotType === 'scatter', size: 4, fill: accentColor, stroke: accentColor }
            }
        ];

        if (hasYErr) seriesList.push({ label: "Y-Err", show: false });
        if (hasXErr) seriesList.push({ label: "X-Err", show: false });

        const opts: uPlot.Options = {
            title: title || (plotType === 'histogram' ? `${xLabel} Distribution` : `${actualYLabel} vs ${xLabel}`),
            width: containerRef.current.clientWidth || 400,
            height: 350,
            cursor: { drag: { x: true, y: true } },
            axes: [ { ...axisConfig, label: xLabel }, { ...axisConfig, label: actualYLabel } ],
            scales: { x: { time: false }, y: { } },
            series: seriesList
        };

        const alignedData: uPlot.AlignedData = [finalX, finalY];
        if (hasYErr) alignedData.push(finalYErr!);
        if (hasXErr) alignedData.push(finalXErr!);

        plotRef.current = new uPlot(opts, alignedData, containerRef.current);

        const handleResize = () => {
            if (plotRef.current && containerRef.current) plotRef.current.setSize({ width: containerRef.current.clientWidth, height: 350 });
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            plotRef.current?.destroy(); plotRef.current = null;
        };
    }, [xData, yData, xErrData, yErrData, xLabel, yLabel, title, plotType, numBins]);

    return <div className="w-100 h-100 d-flex justify-content-center align-items-center" ref={containerRef} />;
};