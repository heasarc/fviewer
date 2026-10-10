import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { FitsImage } from '../../src/components/FitsImage';
import { FViewerContext } from '../../src/core/FViewerContext';
import { createMockContext } from '../utils/PluginTestWrapper';

// Viewport is 100x100 at the origin, so client (50,50) maps to the image center.
beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
        { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (overrides: any = {}, props: any = {}) => {
    const ctx: any = createMockContext(overrides);
    const data = props.data ?? new Float32Array([0, 1, 2, 3]);
    const r = render(
        <FViewerContext.Provider value={ctx}>
            <FitsImage data={data} width={props.width ?? 2} height={props.height ?? 2} />
        </FViewerContext.Provider>);
    const viewport = r.container.querySelector('.flex-grow-1') as HTMLElement;
    return { ...r, ctx, viewport };
};

const pixels = (c: HTMLElement) => {
    const cv = c.querySelector('canvas')!;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(d[i]);
    return out;
};

// image px (ix,iy) in a 100x100 viewport at zoom 1
const at = (ix: number, iy: number, w = 2, h = 2) => ({ clientX: 50 + ix - w / 2, clientY: 50 + iy - h / 2 });

describe('FitsImage canvas painting', () => {
    it('paints gray linear with Y flipped', () => {
        const { container } = mount();
        // data[0]=0 is bottom-left => canvas index 2
        expect(pixels(container)).toEqual([255 * 2 / 3, 255, 0, 255 / 3].map(v => expect.closeTo(v, -1)));
    });

    it('paints with heat colormap and log stretch differently', () => {
        const gray = pixels(mount().container);
        cleanup();
        const heat = mount({ colormap: 'heat' }).container;
        expect(pixels(heat)).not.toEqual(gray);
        cleanup();
        const lin = pixels(mount({}, { data: new Float32Array([0, 1, 2, 4]) }).container);
        cleanup();
        const log = pixels(mount({ stretch: 'log' }, { data: new Float32Array([0, 1, 2, 4]) }).container);
        expect(log).not.toEqual(lin);
    });

    it('handles BigInt64Array input', () => {
        const { container } = mount({}, { data: new BigInt64Array([0n, 10n, 20n, 30n]) });
        const p = pixels(container);
        expect(p[1]).toBe(255);
        expect(p[2]).toBe(0);
    });

    it('handles constant images (max==min)', () => {
        const { container } = mount({}, { data: new Float32Array([5, 5, 5, 5]) });
        expect(pixels(container)).toEqual([0, 0, 0, 0]);
    });

    it('renders no canvas when zoom is null and skips painting for empty size', () => {
        const { container } = mount({ zoom: null });
        expect(container.querySelector('canvas')).toBeNull();
        cleanup();
        const r = mount({}, { width: 0, height: 0, data: new Float32Array(0) });
        expect(r.ctx.setZoom).not.toHaveBeenCalled();
    });
});

describe('FitsImage zoom', () => {
    it('auto fits on mount', () => {
        const { ctx } = mount();
        expect(ctx.setZoom).toHaveBeenCalledWith(50 * 0.95 * 1);
        expect(ctx.setPan).toHaveBeenCalledWith({ x: 0, y: 0 });
    });

    it('wheel zooms with clamping and null handling', () => {
        const { ctx, viewport } = mount();
        ctx.setZoom.mockClear();
        const ev = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
        viewport.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        const up = ctx.setZoom.mock.calls[0][0];
        expect(up(1)).toBeCloseTo(1.1);
        expect(up(49)).toBe(50);
        expect(up(null)).toBe(1);
        viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
        const down = ctx.setZoom.mock.calls[1][0];
        expect(down(1)).toBeCloseTo(0.9);
        expect(down(0.1)).toBe(0.1);
    });
});

describe('FitsImage WCS and hover', () => {
    it('shows No WCS when checkWcs is false or rejects', async () => {
        const a = mount({ fitsWorker: { ...createMockContext().fitsWorker, checkWcs: vi.fn().mockResolvedValue(false) } });
        await waitFor(() => expect(a.container.textContent).toContain('No WCS'));
        cleanup();
        const b = mount({ fitsWorker: { ...createMockContext().fitsWorker, checkWcs: vi.fn().mockRejectedValue(new Error('x')) } });
        await waitFor(() => expect(b.container.textContent).toContain('No WCS'));
    });

    it('updates status bar with pixel, value and async WCS', async () => {
        const pixToWorld = vi.fn().mockResolvedValue({ ra: 10.123456, dec: -5.5 });
        const { container, viewport } = mount({ fitsWorker: { ...createMockContext().fitsWorker, pixToWorld } });
        await waitFor(() => expect(container.textContent).toContain('RA:'));
        fireEvent.mouseMove(viewport, at(1.5, 0.5));
        expect(pixToWorld).toHaveBeenCalledWith(2, 2);
        await waitFor(() => expect(container.textContent).toContain('10.12346'));
        expect(container.textContent).toContain('-5.50000');
        expect(container.textContent).toContain('X: 2');
        expect(container.textContent).toContain('3.000');
        // out of bounds: unchanged
        fireEvent.mouseMove(viewport, at(-10, -10));
        expect(container.textContent).toContain('X: 2');
        expect(pixToWorld).toHaveBeenCalledTimes(1);
    });

    it('survives pixToWorld rejection', async () => {
        const pixToWorld = vi.fn().mockRejectedValue(new Error('no'));
        const { container, viewport } = mount({ fitsWorker: { ...createMockContext().fitsWorker, pixToWorld } });
        await waitFor(() => expect(container.textContent).toContain('RA:'));
        fireEvent.mouseMove(viewport, at(0.5, 0.5));
        await waitFor(() => expect(pixToWorld).toHaveBeenCalled());
        expect(container.textContent).toContain('N/A');
    });

    it('applies the inverse transform (pan, rotation, flips)', () => {
        const { container, viewport } = mount({ pan: { x: 0, y: 0 }, rotation: 90, flipX: true, flipY: true });
        fireEvent.mouseMove(viewport, { clientX: 50, clientY: 50 });
        expect(container.textContent).toContain('X:');
    });
});

describe('FitsImage pan and draw', () => {
    it('pans by dragging in pan mode', () => {
        const { ctx, viewport } = mount();
        fireEvent.mouseDown(viewport, { clientX: 10, clientY: 10 });
        expect(ctx.setSelectedRegionId).toHaveBeenCalledWith(null);
        fireEvent.mouseMove(viewport, { clientX: 25, clientY: 30 });
        expect(ctx.setPan).toHaveBeenLastCalledWith({ x: 15, y: 20 });
        fireEvent.mouseUp(viewport);
        expect(ctx.setDragAction).toHaveBeenCalledWith(null);
    });

    it.each(['circle', 'box', 'annulus'])('draws a %s region', (mode) => {
        const { ctx, viewport } = mount({ drawMode: mode });
        fireEvent.mouseDown(viewport, { clientX: 40, clientY: 40 });
        const draft = ctx.setDraftRegion.mock.calls[0][0];
        expect(draft).toMatchObject({ type: mode, startX: -9, startY: -9 });
        const full = mount({ drawMode: mode, draftRegion: draft });
        fireEvent.mouseDown(full.viewport, { clientX: 40, clientY: 40 });
        fireEvent.mouseMove(full.viewport, { clientX: 60, clientY: 50 });
        const moved = full.ctx.setDraftRegion.mock.calls.at(-1)[0];
        expect(moved.endX).toBe(11);
        cleanup();
        const fin = mount({ drawMode: mode, draftRegion: moved, regions: [] });
        fireEvent.mouseDown(fin.viewport, { clientX: 40, clientY: 40 });
        fireEvent.mouseMove(fin.viewport, { clientX: 60, clientY: 50 });
        fireEvent.mouseUp(fin.viewport);
        const added = fin.ctx.setRegions.mock.calls[0][0][0];
        expect(added.type).toBe(mode);
        if (mode === 'annulus') expect(added.innerR).toBeCloseTo(Math.hypot(20, 10) * 0.5);
        else expect(added.innerR).toBeUndefined();
        expect(fin.ctx.setSelectedRegionId).toHaveBeenCalledWith(added.id);
        expect(fin.ctx.setDrawMode).toHaveBeenCalledWith('pan');
        expect(fin.ctx.setDraftRegion).toHaveBeenLastCalledWith(null);
    });

    it('ignores tiny drags', () => {
        const draft = { id: 'd', type: 'circle', startX: 1, startY: 1, endX: 2, endY: 2, color: '#0f0', angle: 0 };
        const { ctx, viewport } = mount({ drawMode: 'circle', draftRegion: draft });
        fireEvent.mouseUp(viewport);
        expect(ctx.setRegions).not.toHaveBeenCalled();
        expect(ctx.setDraftRegion).toHaveBeenCalledWith(null);
    });

    it('renders the draft region', () => {
        const draft = { id: 'd', type: 'box', startX: 1, startY: 1, endX: 5, endY: 5, color: '#0f0', angle: 0 };
        const { container } = mount({ drawMode: 'box', draftRegion: draft });
        expect(container.querySelector('svg rect')).not.toBeNull();
    });
});

describe('FitsImage region interactions', () => {
    const region = { id: 'r1', type: 'circle', startX: 5, startY: 5, endX: 8, endY: 5, color: '#0f0', angle: 0 };

    it('routes region mouse-down and drag to the core', () => {
        const { ctx, viewport, container } = mount({ regions: [region], dragAction: { id: 'r1', type: 'move' } }, { width: 20, height: 20, data: new Float32Array(400) });
        fireEvent.mouseDown(container.querySelector('svg circle')!, { clientX: 55, clientY: 55 });
        expect(ctx.setSelectedRegionId).toHaveBeenCalledWith('r1');
        expect(ctx.setDragAction).toHaveBeenCalledWith({ id: 'r1', type: 'move' });
        fireEvent.mouseMove(viewport, { clientX: 60, clientY: 60 });
        expect(ctx.handleRegionDrag).toHaveBeenCalled();
    });

    it('ignores region actions outside pan mode', () => {
        const { ctx, container } = mount({ regions: [region], drawMode: 'circle' });
        fireEvent.mouseDown(container.querySelector('svg circle')!);
        expect(ctx.setDragAction).not.toHaveBeenCalledWith({ id: 'r1', type: 'move' });
    });

    it('deletes selected region on Delete/Backspace but not while typing', () => {
        const { ctx } = mount({ selectedRegionId: 'r1', regions: [region] });
        fireEvent.keyDown(window, { key: 'Delete' });
        fireEvent.keyDown(window, { key: 'Backspace' });
        fireEvent.keyDown(window, { key: 'a' });
        expect(ctx.deleteSelectedRegion).toHaveBeenCalledTimes(2);
        const input = document.createElement('input');
        document.body.appendChild(input);
        fireEvent.keyDown(input, { key: 'Delete' });
        const ta = document.createElement('textarea');
        document.body.appendChild(ta);
        fireEvent.keyDown(ta, { key: 'Backspace' });
        expect(ctx.deleteSelectedRegion).toHaveBeenCalledTimes(2);
        input.remove(); ta.remove();
    });

    it('does nothing on Delete without a selection', () => {
        const { ctx } = mount();
        fireEvent.keyDown(window, { key: 'Delete' });
        expect(ctx.deleteSelectedRegion).not.toHaveBeenCalled();
    });
});

describe('FitsImage region pixel extraction', () => {
    const w = 10, h = 10;
    const data = Float32Array.from({ length: 100 }, (_, i) => i);
    const run = (reg: any, extra: any = {}) => {
        const { ctx } = mount({ regions: reg ? [reg] : [], selectedRegionId: reg?.id ?? null, ...extra }, { width: w, height: h, data });
        return ctx.setActiveRegionPixels.mock.calls;
    };
    const base = { id: 'a', color: '#fff', angle: 0 };

    it('null region clears pixels', () => {
        expect(run(null)).toEqual([]); // hash null === initial null => no call
        const c = mount({ regions: [], selectedRegionId: 'zz', isPlotterOpen: true }, { width: w, height: h, data }).ctx;
        expect(c.setActiveRegionPixels).not.toHaveBeenCalled();
    });

    it('box', () => {
        const calls = run({ ...base, type: 'box', startX: 2, startY: 2, endX: 4, endY: 4 });
        expect(calls[0][0]).toHaveLength(9);
    });

    it('rotated box', () => {
        const calls = run({ ...base, type: 'box', startX: 2, startY: 2, endX: 6, endY: 4, angle: 90 });
        expect(calls[0][0].length).toBeGreaterThan(0);
    });

    it('ellipse', () => {
        const calls = run({ ...base, type: 'ellipse', startX: 5, startY: 5, endX: 7, endY: 6 });
        expect(calls[0][0].length).toBeGreaterThan(5);
    });

    it('circle', () => {
        const calls = run({ ...base, type: 'circle', startX: 5, startY: 5, endX: 7, endY: 5 });
        expect(calls[0][0]).toHaveLength(13);
    });

    it('annulus with and without innerR', () => {
        const a = run({ ...base, type: 'annulus', startX: 5, startY: 5, endX: 7, endY: 5, innerR: 1.5 })[0][0];
        cleanup();
        const b = run({ ...base, type: 'annulus', startX: 5, startY: 5, endX: 7, endY: 5 })[0][0];
        expect(a.length).toBeLessThan(b.length);
        expect(b.length).toBeLessThan(13);
    });

    it('jump-starts when plotter is open using last region if none selected', () => {
        const reg = { ...base, type: 'box', startX: 2, startY: 2, endX: 4, endY: 4 };
        const { ctx } = mount({ regions: [reg], isPlotterOpen: true }, { width: w, height: h, data });
        expect(ctx.setActiveRegionPixels).toHaveBeenCalledWith(expect.any(Array));
    });
});

describe('FitsImage catalog overlay', () => {
    const cols = [{ name: 'RA' }, { name: 'Dec' }];
    const mk = (over: any = {}, ra = [1, 2, NaN, 4], dec = [1, 2, 3, 4]) => {
        const worldToPix = vi.fn().mockImplementation(async (r: number) => r === 4 ? null : { x: r + 1, y: r + 1 });
        const readColumn = vi.fn().mockImplementation(async (_i: number, n: string) => ({ data: n === 'RA' ? ra : dec }));
        return {
            activeDataType: 'votable', tableInfo: { columns: cols },
            fitsWorker: { ...createMockContext().fitsWorker, worldToPix },
            voWorker: { readColumn },
            ...over,
        };
    };
    const dots = (c: HTMLElement) => c.querySelectorAll('svg circle');

    it('plots points, skipping NaN and missing pixels; click selects', async () => {
        const o = mk();
        const { container, ctx } = mount(o);
        await waitFor(() => expect(dots(container)).toHaveLength(2));
        expect(o.voWorker.readColumn).toHaveBeenCalledWith(1, 'RA');
        expect(o.voWorker.readColumn).toHaveBeenCalledWith(2, 'Dec');
        fireEvent.click(dots(container)[1]);
        expect(ctx.setSelectedCatalogRow).toHaveBeenCalledWith(1);
    });

    it('highlights selected row', async () => {
        const { container } = mount(mk({ selectedCatalogRow: 0 }));
        await waitFor(() => expect(dots(container)).toHaveLength(2));
        expect(dots(container)[0].getAttribute('stroke')).toBe('#00ff00');
        expect(dots(container)[1].getAttribute('stroke')).toBe('#ffaa00');
    });

    it('does nothing when RA/Dec columns are missing', async () => {
        const o = mk({ tableInfo: { columns: [{ name: 'x' }] } });
        const { container } = mount(o);
        await new Promise(r => setTimeout(r, 30));
        expect(o.voWorker.readColumn).not.toHaveBeenCalled();
        expect(dots(container)).toHaveLength(0);
    });

    it('logs when readColumn rejects', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const o = mk();
        o.voWorker.readColumn = vi.fn().mockRejectedValue(new Error('boom'));
        mount(o);
        await waitFor(() => expect(err).toHaveBeenCalled());
    });

    it('shows no catalog for non-votable data', async () => {
        const { container } = mount(mk({ activeDataType: 'fits' }));
        await new Promise(r => setTimeout(r, 20));
        expect(dots(container)).toHaveLength(0);
    });
});
