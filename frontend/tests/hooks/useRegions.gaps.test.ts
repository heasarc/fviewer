import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegions } from '../../src/hooks/useRegions';

const reg = (o: any = {}) => ({ id: 'r1', type: 'circle', startX: 0, startY: 0, endX: 10, endY: 0, color: '#fff', ...o });
const run = (set: any, init: any[]) => set.mock.calls[set.mock.calls.length - 1][0](init);

describe('useRegions gaps', () => {
    it('deleteSelectedRegion does nothing without a selection', () => {
        const set = vi.fn();
        const { result } = renderHook(() => useRegions(set));
        act(() => result.current.deleteSelectedRegion());
        expect(set).not.toHaveBeenCalled();
    });

    it('handleRegionDrag does nothing without a drag action', () => {
        const set = vi.fn();
        const { result } = renderHook(() => useRegions(set));
        act(() => result.current.handleRegionDrag(1, 1, 1, 1));
        expect(set).not.toHaveBeenCalled();
    });

    const drag = (type: any, r: any, args: [number, number, number, number]) => {
        const set = vi.fn();
        const { result } = renderHook(() => useRegions(set));
        act(() => result.current.setDragAction({ id: 'r1', type }));
        act(() => result.current.handleRegionDrag(...args));
        return run(set, [r, reg({ id: 'other' })]);
    };

    it('rotates box and non-box regions around their centers', () => {
        const out = drag('rotate', reg({ type: 'box', endX: 10, endY: 10 }), [5, 0, 0, 0]);
        expect(out[0].angle).toBeCloseTo(0);
        expect(out[1].id).toBe('other');
        const out2 = drag('rotate', reg(), [0, 5, 0, 0]);
        expect(out2[0].angle).toBeCloseTo(180);
    });

    it('resizes in the rotated frame', () => {
        const out = drag('resize', reg({ angle: 90 }), [0, 0, 1, 0]);
        expect(out[0].endX).toBeCloseTo(10);
        expect(out[0].endY).toBeCloseTo(-1);
        const out2 = drag('resize', reg(), [0, 0, 2, 3]);
        expect(out2[0].endX).toBeCloseTo(12);
    });

    it('resize-inner clamps to a minimum of 1 for box and circle', () => {
        const out = drag('resize-inner', reg({ type: 'box', endX: 10, endY: 10 }), [5, 5, 0, 0]);
        expect(out[0].innerR).toBe(1);
        const out2 = drag('resize-inner', reg(), [3, 4, 0, 0]);
        expect(out2[0].innerR).toBe(5);
    });

    it('move shifts both corners', () => {
        const out = drag('move', reg(), [0, 0, 2, 3]);
        expect(out[0]).toMatchObject({ startX: 2, startY: 3, endX: 12, endY: 3 });
    });

    it('unknown drag type leaves the region unchanged', () => {
        const r = reg();
        expect(drag('bogus', r, [0, 0, 1, 1])[0]).toEqual(r);
    });
});
