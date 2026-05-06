// # Copyright 2026, University of Maryland, All Rights Reserved

import { useState } from 'react';
import type { Region } from '../utils/regionUtils';
import type { DrawMode } from '../components/FitsImage';

export const useRegions = (
    setRegions: React.Dispatch<React.SetStateAction<Region[]>>
) => {
    const [drawMode, setDrawMode] = useState<DrawMode>('pan');
    const [draftRegion, setDraftRegion] = useState<Region | null>(null);
    const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [dragAction, setDragAction] = useState<{ id: string, type: 'move' | 'resize' | 'rotate' | 'resize-inner' } | null>(null);
    
    const deleteSelectedRegion = () => {
        if (selectedRegionId) {
            setRegions(prev => prev.filter(r => r.id !== selectedRegionId));
            setSelectedRegionId(null);
            setDragAction(null);
        }
    };

    const handleRegionDrag = (x: number, y: number, dx: number, dy: number) => {
        if (!dragAction) return;

        setRegions(prev => prev.map(r => {
            if (r.id === dragAction.id) {
                if (dragAction.type === 'move') {
                    return { ...r, startX: r.startX + dx, startY: r.startY + dy, endX: r.endX + dx, endY: r.endY + dy };
                } 
                else if (dragAction.type === 'rotate') {
                    const cx = r.type === 'box' ? (r.startX + r.endX) / 2 : r.startX;
                    const cy = r.type === 'box' ? (r.startY + r.endY) / 2 : r.startY;
                    const angleRad = Math.atan2(y - cy, x - cx);
                    return { ...r, angle: (angleRad * 180 / Math.PI) + 90 };
                }
                else if (dragAction.type === 'resize') {
                    const rad = -(r.angle || 0) * (Math.PI / 180);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const localDx = dx * cos - dy * sin;
                    const localDy = dx * sin + dy * cos;
                    return { ...r, endX: r.endX + localDx, endY: r.endY + localDy };
                }
                else if (dragAction.type === 'resize-inner') {
                    const cx = r.type === 'box' ? (r.startX + r.endX) / 2 : r.startX;
                    const cy = r.type === 'box' ? (r.startY + r.endY) / 2 : r.startY;
                    const newInnerR = Math.max(1, Math.hypot(x - cx, y - cy));
                    return { ...r, innerR: newInnerR };
                }
            }
            return r;
        }));
    };

    return {
        drawMode, setDrawMode,
        draftRegion, setDraftRegion,
        selectedRegionId, setSelectedRegionId,
        hoveredRegionId, setHoveredRegionId,
        dragAction, setDragAction,
        deleteSelectedRegion,
        handleRegionDrag
    };
};