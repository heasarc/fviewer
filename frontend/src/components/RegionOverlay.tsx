// # Copyright 2026, University of Maryland, All Rights Reserved

import React from 'react';
import type { Region, DrawMode } from '../utils/regionUtils';

interface RegionShapeProps {
    region: Region;
    isDraft?: boolean;
    isSelected: boolean;
    isHovered: boolean;
    zoom: number;
    drawMode: DrawMode;
    onAction: (id: string, actionType: 'move' | 'rotate' | 'resize' | 'resize-inner', e: React.MouseEvent) => void;
    onHover: (id: string | null) => void;
}

export const RegionShape: React.FC<RegionShapeProps> = ({ 
    region: r, isDraft = false, isSelected, isHovered, zoom, drawMode, onAction, onHover 
}) => {
    const handleSize = 10 / zoom;
    let shapeElement;
    let cx: number, cy: number, topEdgeY: number = 0;

    if (r.type === 'box') {
        const minX = Math.min(r.startX, r.endX);
        const minY = Math.min(r.startY, r.endY);
        const w = Math.abs(r.endX - r.startX);
        const h = Math.abs(r.endY - r.startY);
        cx = (r.startX + r.endX) / 2;
        cy = (r.startY + r.endY) / 2;
        topEdgeY = minY;
        shapeElement = <rect x={minX} y={minY} width={w} height={h} />;
    } 
    else if (r.type === 'ellipse') {
        cx = r.startX; cy = r.startY;
        const rx = Math.abs(r.endX - r.startX);
        const ry = Math.abs(r.endY - r.startY);
        topEdgeY = cy - ry;
        shapeElement = <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />;
    }
    else if (r.type === 'annulus') {
        cx = r.startX; cy = r.startY;
        const outerRadius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
        const innerRadius = r.innerR ?? (outerRadius * 0.5);
        topEdgeY = cy - outerRadius;
        shapeElement = (
            <g>
                <circle cx={cx} cy={cy} r={outerRadius} />
                <circle cx={cx} cy={cy} r={innerRadius} />
            </g>
        );
    }
    else { 
        const radius = Math.hypot(r.endX - r.startX, r.endY - r.startY);
        cx = r.startX; cy = r.startY;
        topEdgeY = cy - radius;
        shapeElement = <circle cx={cx} cy={cy} r={radius} />;
    }

    const handleRegionMouseDown = (e: React.MouseEvent) => {
        if (drawMode !== 'pan') return;
        e.stopPropagation(); 
        onAction(r.id, 'move', e);
    };

    return (
        <g transform={`rotate(${r.angle || 0} ${cx} ${cy})`}>
            {/* 1. Invisible Fat Click Target */}
            {React.cloneElement(shapeElement, {
                style: {
                    stroke: 'rgba(255,255,255,0.01)', 
                    strokeWidth: Math.max(10, 20 / zoom), fill: 'none',
                    pointerEvents: isDraft || drawMode !== 'pan' ? 'none' : 'stroke',
                    cursor: drawMode === 'pan' ? 'move' : 'crosshair'
                },
                onMouseDown: handleRegionMouseDown,
                onMouseEnter: () => onHover(r.id),
                onMouseLeave: () => onHover(null)
            })}
            
            {/* 2. Thin Visual Outline */}
            {React.cloneElement(shapeElement, {
                style: {
                    stroke: isHovered && drawMode === 'pan' && !isDraft ? '#fff' : r.color, 
                    strokeWidth: (isHovered && drawMode === 'pan' && !isDraft ? 4 : 2) / zoom, 
                    strokeDasharray: r.isBackground ? `${6 / zoom}, ${6 / zoom}` : 'none',
                    fill: 'none', pointerEvents: 'none',
                    transition: 'stroke 0.1s, stroke-width 0.1s'
                }
            })}

            {/* 3. Handles */}
            {isSelected && !isDraft && (
                <>
                    {(r.type === 'box' || r.type === 'ellipse') && (
                        <>
                            <line x1={cx} y1={topEdgeY} x2={cx} y2={topEdgeY - (25/zoom)} stroke={r.color} strokeWidth={1/zoom} pointerEvents="none" />
                            <circle cx={cx} cy={topEdgeY - (25/zoom)} r={handleSize/2} fill={r.color} 
                                style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                                onMouseDown={(e) => { e.stopPropagation(); onAction(r.id, 'rotate', e); }}
                            />
                        </>
                    )}

                    <rect x={r.endX - handleSize / 2} y={r.endY - handleSize / 2} width={handleSize} height={handleSize} 
                        fill="#fff" stroke={r.color} strokeWidth={1/zoom}
                        style={{ cursor: 'nwse-resize', pointerEvents: 'all' }}
                        onMouseDown={(e) => { e.stopPropagation(); onAction(r.id, 'resize', e); }}
                    />
                    
                    {r.type === 'annulus' && (
                        <rect x={cx + (r.innerR ?? (Math.hypot(r.endX - r.startX, r.endY - r.startY) * 0.5)) - handleSize / 2} y={cy - handleSize / 2} 
                            width={handleSize} height={handleSize} fill="#fff" stroke={r.color} strokeWidth={1/zoom}
                            style={{ cursor: 'e-resize', pointerEvents: 'all' }}
                            onMouseDown={(e) => { e.stopPropagation(); onAction(r.id, 'resize-inner', e); }}
                        />
                    )}
                </>
            )}
        </g>
    );
};