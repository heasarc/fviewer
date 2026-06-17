// # Copyright 2026, University of Maryland, All Rights Reserved

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
    pointSize?: number;
    pointColor?: string;
    subsetMode?: 'all' | 'range' | 'random';
    subsetRange?: [number, number];
    subsetRandomN?: number;
    logX?: boolean;
    logY?: boolean;
}

export const FitsPlot: React.FC<FitsPlotProps> = ({ 
    xData, yData, xErrData, yErrData, xLabel, yLabel, title, 
    plotType = 'scatter', numBins = 50,
    pointSize, pointColor,
    subsetMode = 'all', subsetRange = [0, 10000], subsetRandomN = 10000,
    logX = false, logY = false
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
                    // TypeScript Fix: Extract to constants so the type checker can safely narrow them!
                    const xVal = dataX[i];
                    const yVal = dataY[i];
                    
                    if (xVal == null || yVal == null) continue;
                    
                    const cx = Math.round(valToPosX(xVal, scaleX, xDim, xOff));
                    const cy = Math.round(valToPosY(yVal, scaleY, yDim, yOff));

                    if (yErr) {
                        const yE = yErr[i];
                        if (yE != null) {
                            const yMin = Math.round(valToPosY(yVal - yE, scaleY, yDim, yOff));
                            const yMax = Math.round(valToPosY(yVal + yE, scaleY, yDim, yOff));
                            ctx.moveTo(cx, yMin); ctx.lineTo(cx, yMax);
                            ctx.moveTo(cx - 3, yMin); ctx.lineTo(cx + 3, yMin); 
                            ctx.moveTo(cx - 3, yMax); ctx.lineTo(cx + 3, yMax); 
                        }
                    }

                    if (xErr) {
                        const xE = xErr[i];
                        if (xE != null) {
                            const xMin = Math.round(valToPosX(xVal - xE, scaleX, xDim, xOff));
                            const xMax = Math.round(valToPosX(xVal + xE, scaleX, xDim, xOff));
                            ctx.moveTo(xMin, cy); ctx.lineTo(xMax, cy);
                            ctx.moveTo(xMin, cy - 3); ctx.lineTo(xMin, cy + 3); 
                            ctx.moveTo(xMax, cy - 3); ctx.lineTo(xMax, cy + 3); 
                        }
                    }
                }
                ctx.stroke();
            });
            return null; 
        };

        // --- CUSTOM UPLOT HIGH-PERFORMANCE SCATTER BUILDER ---
        const scatterPathBuilder = (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
            uPlot.orient(u, seriesIdx, (_series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
                const ctx = u.ctx;
                ctx.fillStyle = pointColor as string; 
                ctx.beginPath();
                
                // Use the user's size, or fallback to the massive dataset optimization
                const size = pointSize || (isMassive ? 1 : 2);
                const offset = Math.floor(size / 2);

                for (let i = idx0; i <= idx1; i++) {
                    const xVal = dataX[i];
                    const yVal = dataY[i];
                    if (xVal == null || yVal == null) continue;
                    
                    const cx = Math.round(valToPosX(xVal, scaleX, xDim, xOff));
                    const cy = Math.round(valToPosY(yVal, scaleY, yDim, yOff));
                    
                    ctx.fillRect(cx - offset, cy - offset, size, size); 
                }
            });
            return null; 
        };

        // --- MATH & DATA PREPARATION ---
        const len = xData.length;
        
        // 1. Determine which indices fall into the allowed range safely
        let startIndex = 0;
        let endIndex = len - 1;

        if (subsetMode === 'range') {
            // Automatically swap start and end if the user enters them backwards
            const actualStart = Math.min(subsetRange[0], subsetRange[1]);
            const actualEnd = Math.max(subsetRange[0], subsetRange[1]);
            
            startIndex = Math.max(0, actualStart);
            endIndex = Math.min(len - 1, actualEnd);
        }

        // Ensure we never pass a negative number to Uint32Array
        const safeLength = Math.max(0, endIndex - startIndex + 1);
        const indices = new Uint32Array(safeLength);
        let validCount = 0;

        for (let i = startIndex; i <= endIndex; i++) {
            const xV = Number(xData[i]);
            if (!isNaN(xV)) {
                // Skip non-positive values if X is logarithmic
                if (logX && xV <= 0) continue;

                if (plotType === 'histogram') {
                    indices[validCount++] = i;
                } else if (yData && yData[i] != null && !isNaN(Number(yData[i]))) {
                    const yV = Number(yData[i]);
                    if (logY && yV <= 0) continue;
                    indices[validCount++] = i;
                }
            }
        }

        let validIndices = indices.subarray(0, validCount);

        // 2. Apply Random Sampling (Fisher-Yates / Reservoir algorithm)
        if (subsetMode === 'random' && validCount > subsetRandomN) {
            for (let i = 0; i < subsetRandomN; i++) {
                const j = i + Math.floor(Math.random() * (validCount - i));
                const temp = validIndices[i];
                validIndices[i] = validIndices[j];
                validIndices[j] = temp;
            }
            validIndices = validIndices.subarray(0, subsetRandomN);
            validCount = subsetRandomN;
        }

        // 3. Build the final arrays
        if (plotType === 'histogram') {
            let min = Infinity; let max = -Infinity;
            const valid = new Array(validCount);
            
            for (let i = 0; i < validCount; i++) {
                const v = Number(xData[validIndices[i]]);
                valid[i] = v;
                if (v < min) min = v;
                if (v > max) max = v;
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

                // If logY is true for a histogram, 0 counts will crash uPlot.
                // We replace 0s with null so uPlot ignores them.
                if (logY) {
                    finalY = finalY.map(v => v <= 0 ? null : v) as any;
                }
            }
        } 
        else {
            if (!yData) return;
            // Sort by X for proper rendering
            validIndices.sort((a, b) => Number(xData[a]) - Number(xData[b]));

            finalX = new Array(validCount);
            finalY = new Array(validCount);
            if (hasYErr) finalYErr = new Array(validCount);
            if (hasXErr) finalXErr = new Array(validCount);

            for (let i = 0; i < validCount; i++) {
                const idx = validIndices[i];
                finalX[i] = Number(xData[idx]);
                finalY[i] = Number(yData[idx]);
                if (hasYErr) finalYErr![i] = Number(yErrData![idx]);
                if (hasXErr) finalXErr![i] = Number(xErrData![idx]);
            }
        }

        if (finalX.length === 0) return;

        // --- DARK THEME STYLING ---
        const textColor = '#c8cfe8'; 
        const gridColor = '#3a3f60'; 

        const isMassive = finalX.length > 10000;

        const axisConfig: uPlot.Axis = { stroke: textColor, grid: { show: true, stroke: gridColor, width: 1 }, ticks: { show: true, stroke: gridColor, width: 1 } };

        const seriesList: uPlot.Series[] = [
            {}, // X-axis
            {
                label: actualYLabel, 
                stroke: pointColor, 
                fill: 'rgba(126, 200, 227, 0.15)',
                // Use our custom builders for scatter, or uPlot's built-in stepped path for histograms
                paths: plotType === 'histogram' 
                    ? uPlot.paths.stepped!({ align: 1 }) 
                    : (hasYErr || hasXErr ? errorBarBuilder : scatterPathBuilder),
                
                // Disable uPlot's default point rendering entirely, 
                // because our custom path builders draw the points much faster!
                points: { show: false } 
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
            scales: { 
                x: { 
                    time: false,
                    distr: logX ? 3 : 1 // 3 = log10, 1 = linear
                }, 
                y: { 
                    distr: logY ? 3 : 1
                } 
            },
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
    }, [
        xData, yData, xErrData, yErrData, xLabel, yLabel, title, plotType, numBins,
        pointSize, pointColor, subsetMode, subsetRange[0], subsetRange[1], subsetRandomN,
        logX, logY
    ]);

    return <div className="w-100 h-100 d-flex justify-content-center align-items-center" ref={containerRef} />;
};