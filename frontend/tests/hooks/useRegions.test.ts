// # Copyright 2026, University of Maryland, All Rights Reserved

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegions } from '../../src/hooks/useRegions';
import type { Region } from '../../src/utils/regionUtils';

describe('useRegions Hook', () => {
    // 1. Properly type the mock to satisfy TypeScript
    let mockSetRegions: ReturnType<typeof vi.fn> & React.Dispatch<React.SetStateAction<Region[]>>;

    beforeEach(() => {
        // 2. Cast the vi.fn() to the correct React Dispatch type
        mockSetRegions = vi.fn() as unknown as ReturnType<typeof vi.fn> & React.Dispatch<React.SetStateAction<Region[]>>;
    });

    // Helper to extract and run the functional state update passed to setRegions
    const applySetRegions = (initialState: Region[]): Region[] => {
        expect(mockSetRegions).toHaveBeenCalled();
        const updater = mockSetRegions.mock.calls[mockSetRegions.mock.calls.length - 1][0];
        return typeof updater === 'function' ? updater(initialState) : updater;
    };

    it('should initialize with default states', () => {
        const { result } = renderHook(() => useRegions(mockSetRegions));
        
        expect(result.current.drawMode).toBe('pan');
        expect(result.current.draftRegion).toBeNull();
        expect(result.current.selectedRegionId).toBeNull();
        expect(result.current.hoveredRegionId).toBeNull();
        expect(result.current.dragAction).toBeNull();
    });

    it('should allow basic state updates via setters', () => {
        const { result } = renderHook(() => useRegions(mockSetRegions));
        
        act(() => {
            result.current.setDrawMode('circle');
            result.current.setSelectedRegionId('reg-1');
            result.current.setHoveredRegionId('reg-2');
            result.current.setDragAction({ id: 'reg-1', type: 'move' });
        });

        expect(result.current.drawMode).toBe('circle');
        expect(result.current.selectedRegionId).toBe('reg-1');
        expect(result.current.hoveredRegionId).toBe('reg-2');
        expect(result.current.dragAction).toEqual({ id: 'reg-1', type: 'move' });
    });

    describe('deleteSelectedRegion', () => {
        it('should do nothing if no region is selected', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.deleteSelectedRegion();
            });

            expect(mockSetRegions).not.toHaveBeenCalled();
        });

        it('should filter out the selected region and reset states', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setSelectedRegionId('reg-1');
                result.current.setDragAction({ id: 'reg-1', type: 'move' });
            });

            act(() => {
                result.current.deleteSelectedRegion();
            });

            const initialRegions: Region[] = [
                { id: 'reg-1', type: 'circle', startX: 0, startY: 0, endX: 10, endY: 10, color: 'green' },
                { id: 'reg-2', type: 'box', startX: 5, startY: 5, endX: 15, endY: 15, color: 'red' }
            ];

            const newRegions = applySetRegions(initialRegions);
            expect(newRegions).toHaveLength(1);
            expect(newRegions[0].id).toBe('reg-2');
            expect(result.current.selectedRegionId).toBeNull();
            expect(result.current.dragAction).toBeNull();
        });
    });

    describe('handleRegionDrag', () => {
        const dummyRegion: Region = { 
            id: 'reg-1', type: 'box', startX: 10, startY: 10, endX: 30, endY: 30, color: 'green' 
        };
        const dummyCircle: Region = {
            id: 'reg-2', type: 'circle', startX: 20, startY: 20, endX: 30, endY: 30, color: 'red'
        };

        it('should do nothing if dragAction is null', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.handleRegionDrag(0, 0, 5, 5);
            });

            expect(mockSetRegions).not.toHaveBeenCalled();
        });

        it('should return region unchanged if ID does not match dragAction', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-999', type: 'move' });
            });

            act(() => {
                result.current.handleRegionDrag(0, 0, 5, 5);
            });

            const newRegions = applySetRegions([dummyRegion]);
            expect(newRegions[0]).toEqual(dummyRegion);
        });

        it('should handle "move" action by translating start and end coordinates', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-1', type: 'move' });
            });

            act(() => {
                result.current.handleRegionDrag(0, 0, 5, -5); // dx: 5, dy: -5
            });

            const newRegions = applySetRegions([dummyRegion]);
            expect(newRegions[0].startX).toBe(15);
            expect(newRegions[0].startY).toBe(5);
            expect(newRegions[0].endX).toBe(35);
            expect(newRegions[0].endY).toBe(25);
        });

        it('should handle "rotate" action for a box', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-1', type: 'rotate' });
            });

            // Center of dummyRegion (box) is (20, 20).
            // Dragging to x=20, y=30 (straight down) -> atan2(10, 0) -> PI/2
            // Expected angle: (PI/2 * 180/PI) + 90 = 90 + 90 = 180 degrees
            act(() => {
                result.current.handleRegionDrag(20, 30, 0, 0);
            });

            const newRegions = applySetRegions([dummyRegion]);
            expect(newRegions[0].angle).toBe(180);
        });

        it('should handle "rotate" action for a circle/ellipse', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-2', type: 'rotate' });
            });

            // Center of dummyCircle is its startX/startY: (20, 20).
            // Dragging to x=30, y=20 (straight right) -> atan2(0, 10) -> 0
            // Expected angle: (0 * 180/PI) + 90 = 90 degrees
            act(() => {
                result.current.handleRegionDrag(30, 20, 0, 0);
            });

            const newRegions = applySetRegions([dummyCircle]);
            expect(newRegions[0].angle).toBe(90);
        });

        it('should handle "resize" action with rotation taken into account', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-1', type: 'resize' });
            });

            // Let's test with a region rotated at 90 degrees
            const rotatedRegion = { ...dummyRegion, angle: 90 };
            
            // At 90 deg rotation, inverse rotation is -90 deg.
            // cos(-90) = ~0, sin(-90) = -1.
            // dx=5, dy=0 -> localDx = 5*(0) - 0*(-1) = 0
            // localDy = 5*(-1) + 0*(0) = -5
            // So endY should decrease by 5, endX unchanged.
            act(() => {
                result.current.handleRegionDrag(0, 0, 5, 0);
            });

            const newRegions = applySetRegions([rotatedRegion]);
            // Use toBeCloseTo due to JS floating point math on Math.PI
            expect(newRegions[0].endX).toBeCloseTo(30); 
            expect(newRegions[0].endY).toBeCloseTo(25);
        });

        it('should handle "resize" action with 0 rotation', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-1', type: 'resize' });
            });

            // If angle is 0, localDx/localDy should exactly match dx/dy
            const unrotatedRegion = { ...dummyRegion, angle: 0 };
            
            act(() => {
                result.current.handleRegionDrag(0, 0, 10, 15);
            });

            const newRegions = applySetRegions([unrotatedRegion]);
            expect(newRegions[0].endX).toBe(40); // 30 + 10
            expect(newRegions[0].endY).toBe(45); // 30 + 15
        });

        it('should handle "resize-inner" action for a box (annulus)', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-1', type: 'resize-inner' });
            });

            // Center of dummyRegion (box) is (20, 20).
            // Drag pointer to (20, 10). Distance from center is 10.
            act(() => {
                result.current.handleRegionDrag(20, 10, 0, 0);
            });

            const newRegions = applySetRegions([dummyRegion]);
            expect(newRegions[0].innerR).toBe(10);
        });

        it('should handle "resize-inner" action for a circle/ellipse', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-2', type: 'resize-inner' });
            });

            // Center of dummyCircle is (20, 20).
            // Drag pointer to (23, 24). dx=3, dy=4. hypot(3,4) = 5.
            act(() => {
                result.current.handleRegionDrag(23, 24, 0, 0);
            });

            const newRegions = applySetRegions([dummyCircle]);
            expect(newRegions[0].innerR).toBe(5);
        });

        it('should enforce a minimum innerR of 1 on resize-inner', () => {
            const { result } = renderHook(() => useRegions(mockSetRegions));
            
            act(() => {
                result.current.setDragAction({ id: 'reg-2', type: 'resize-inner' });
            });

            // Center is (20, 20). Drag to (20, 20.5). Distance is 0.5.
            // Should fallback to Math.max(1, 0.5) -> 1
            act(() => {
                result.current.handleRegionDrag(20, 20.5, 0, 0);
            });

            const newRegions = applySetRegions([dummyCircle]);
            expect(newRegions[0].innerR).toBe(1);
        });
    });
});