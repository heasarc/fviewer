import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { initImageControlPlugin } from '../../src/plugins/ImageControlPlugin';
import { initTransformPlugin } from '../../src/plugins/TransformPlugin';
import { initZoomPlugin } from '../../src/plugins/ZoomPlugin';
import { initRegionToolbarPlugin } from '../../src/plugins/RegionToolbarPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ImageControlPlugin (more)', () => {
    const slot = 'fitsimage:toolbar';
    it.each([['Grayscale', 'gray'], ['Heat', 'heat'], ['Cool', 'cool']])('colormap %s', (label, v) => {
        const setColormap = vi.fn();
        renderPluginSlot(initImageControlPlugin, slot, { setColormap });
        fireEvent.click(screen.getByText(label));
        expect(setColormap).toHaveBeenCalledWith(v);
    });
    it.each([['Linear', 'linear'], ['Log', 'log'], ['Square Root', 'square root'], ['ASINH', 'asinh']])('stretch %s', (label, v) => {
        const setStretch = vi.fn();
        renderPluginSlot(initImageControlPlugin, slot, { setStretch });
        fireEvent.click(screen.getByText(label));
        expect(setStretch).toHaveBeenCalledWith(v);
    });
    it('marks the active colormap and stretch', () => {
        const { container } = renderPluginSlot(initImageControlPlugin, slot, { colormap: 'heat', stretch: 'log' });
        expect(container.querySelectorAll('.bi-check2')).toHaveLength(2);
    });
    it('handles the API commands', async () => {
        const setStretch = vi.fn();
        const { executeCommand } = renderPluginSlot(initImageControlPlugin, slot, { setStretch, colormap: 'cool', stretch: 'asinh' });
        const reply = vi.fn();
        await executeCommand({ action: 'get_colormap', message_id: 1 }, reply);
        expect(reply).toHaveBeenLastCalledWith({ message_id: 1, colormap: 'cool' });
        await executeCommand({ action: 'get_stretch', message_id: 2 }, reply);
        expect(reply).toHaveBeenLastCalledWith({ message_id: 2, stretch: 'asinh' });
        await executeCommand({ action: 'set_stretch', stretch: 'log', message_id: 3 }, reply);
        expect(setStretch).toHaveBeenCalledWith('log');
        await executeCommand({ action: 'set_stretch', message_id: 4 }, reply);
        expect(setStretch).toHaveBeenCalledTimes(1);
        await executeCommand({ action: 'set_colormap', message_id: 5 }, reply);
        expect(reply).toHaveBeenLastCalledWith({ message_id: 5, status: 'ok' });
    });
    it('unregisters commands on unmount', async () => {
        const { unmount, executeCommand } = renderPluginSlot(initImageControlPlugin, slot);
        unmount();
        const reply = vi.fn();
        await executeCommand({ action: 'get_colormap', message_id: 1 }, reply).catch(() => {});
        expect(reply).not.toHaveBeenCalledWith(expect.objectContaining({ colormap: expect.anything() }));
    });
});

describe('TransformPlugin', () => {
    const slot = 'fitsimage:toolbar';
    it('flips and rotates', () => {
        const setFlipX = vi.fn(), setFlipY = vi.fn(), setRotation = vi.fn();
        renderPluginSlot(initTransformPlugin, slot, { setFlipX, setFlipY, setRotation, flipX: false, flipY: true, rotation: 10 });
        fireEvent.click(screen.getByText('Flip X'));
        expect(setFlipX).toHaveBeenCalledWith(true);
        fireEvent.click(screen.getByText('Flip Y'));
        expect(setFlipY).toHaveBeenCalledWith(false);
        fireEvent.click(screen.getByText(/Rotate CCW/));
        fireEvent.click(screen.getByText(/Rotate CW/));
        expect(setRotation.mock.calls[0][0](0)).toBe(-90);
        expect(setRotation.mock.calls[1][0](0)).toBe(90);
    });
    it('sets a custom angle, treating junk as 0', () => {
        const setRotation = vi.fn();
        renderPluginSlot(initTransformPlugin, slot, { setRotation, rotation: 10 });
        const input = screen.getByDisplayValue('10');
        fireEvent.change(input, { target: { value: '45' } });
        expect(setRotation).toHaveBeenLastCalledWith(45);
        fireEvent.change(input, { target: { value: '' } });
        expect(setRotation).toHaveBeenLastCalledWith(0);
    });
});

describe('ZoomPlugin (more)', () => {
    const slot = 'fitsimage:toolbar:right';
    it('zooms in and out with clamping', () => {
        const setZoom = vi.fn();
        renderPluginSlot(initZoomPlugin, slot, { setZoom, zoom: 2 });
        fireEvent.click(screen.getByText('Zoom In'));
        fireEvent.click(screen.getByText('Zoom Out'));
        const [inFn, outFn] = setZoom.mock.calls.map(c => c[0]);
        expect(inFn(2)).toBeCloseTo(2.4);
        expect(inFn(49)).toBe(50);
        expect(inFn(null)).toBeCloseTo(1.2);
        expect(outFn(2)).toBeCloseTo(1.6);
        expect(outFn(0.11)).toBe(0.1);
        expect(outFn(null)).toBeCloseTo(0.8);
    });
    it('shows the zoom percentage, or 0 when null', () => {
        renderPluginSlot(initZoomPlugin, slot, { zoom: 1.5 });
        expect(screen.getByText('Zoom (150%)')).toBeInTheDocument();
        cleanup();
        renderPluginSlot(initZoomPlugin, slot, { zoom: null });
        expect(screen.getByText('Zoom (0%)')).toBeInTheDocument();
    });
    it('resets flips too', () => {
        const setFlipX = vi.fn(), setFlipY = vi.fn();
        renderPluginSlot(initZoomPlugin, slot, { setFlipX, setFlipY });
        fireEvent.click(screen.getByText('Reset View'));
        expect(setFlipX).toHaveBeenCalledWith(false);
        expect(setFlipY).toHaveBeenCalledWith(false);
    });
});

describe('RegionToolbarPlugin (more)', () => {
    const slot = 'fitsimage:toolbar:left';
    const img = { width: 100, height: 100, pixScale: { scaleX: 1 } };
    const regions = [{ id: 'a', type: 'circle', startX: 1, startY: 1, endX: 5, endY: 1, isBackground: false }];
    beforeEach(() => { vi.spyOn(window, 'alert').mockImplementation(() => {}); });

    it.each([['Pointer / Pan', 'pan'], ['Box', 'box'], ['Ellipse', 'ellipse'], ['Annulus', 'annulus']])('draw mode %s', (label, mode) => {
        const setDrawMode = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, slot, { setDrawMode });
        fireEvent.click(screen.getByText(label));
        expect(setDrawMode).toHaveBeenCalledWith(mode);
    });

    it('toggles background on the selected region only', () => {
        const setRegions = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions, selectedRegionId: 'a', setRegions });
        fireEvent.click(screen.getByText('Set as Background'));
        const out = setRegions.mock.calls[0][0]([...regions, { id: 'b', isBackground: false }]);
        expect(out[0].isBackground).toBe(true);
        expect(out[1].isBackground).toBe(false);
    });

    it('disables selection-dependent items and deletes the selected region', () => {
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions: [] });
        expect(screen.getByText('Set as Background').closest('button')).toBeDisabled();
        expect(screen.getByText(/Delete Selected/).closest('button')).toBeDisabled();
        cleanup();
        const deleteSelectedRegion = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions, selectedRegionId: 'a', deleteSelectedRegion });
        fireEvent.click(screen.getByText(/Delete Selected/));
        expect(deleteSelectedRegion).toHaveBeenCalled();
    });

    it('opens the server modal only when connected', () => {
        const setServerModalMode = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, slot, { setServerModalMode });
        fireEvent.click(screen.getByText(/Load Server Regions/));
        expect(setServerModalMode).toHaveBeenCalledWith('region');
        cleanup();
        renderPluginSlot(initRegionToolbarPlugin, slot, { isConnected: false });
        expect(screen.queryByText(/Load Server Regions/)).toBeNull();
    });

    it('loads a local region file, appending to existing regions', async () => {
        const setRegions = vi.fn();
        const { container } = renderPluginSlot(initRegionToolbarPlugin, slot, { setRegions, imageData: img });
        const input = container.querySelector('input[type=file]') as HTMLInputElement;
        const click = vi.spyOn(input, 'click').mockImplementation(() => {});
        fireEvent.click(screen.getByText(/Load Local Regions/));
        expect(click).toHaveBeenCalled();
        const file = new File(['image\ncircle(10,10,5)\n'], 'r.reg');
        fireEvent.change(input, { target: { files: [file] } });
        await waitFor(() => expect(setRegions).toHaveBeenCalled());
        expect(setRegions.mock.calls[0][0]([{ id: 'old' }])[0]).toEqual({ id: 'old' });
        expect(setRegions.mock.calls[0][0]([]).length).toBe(1);
    });

    it('ignores loading without a file or image', async () => {
        const setRegions = vi.fn();
        const { container } = renderPluginSlot(initRegionToolbarPlugin, slot, { setRegions, imageData: null });
        const input = container.querySelector('input[type=file]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'r.reg')] } });
        fireEvent.change(input, { target: { files: [] } });
        await new Promise(r => setTimeout(r, 20));
        expect(setRegions).not.toHaveBeenCalled();
    });

    it('saves regions as a downloaded .reg file', async () => {
        const created: any[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((b: any) => { created.push(b); return 'blob:x'; });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions, imageData: img, fileName: 'my.FITS' });
        fireEvent.change(screen.getByDisplayValue('Image'), { target: { value: 'physical' } });
        fireEvent.click(screen.getByText('Save'));
        await waitFor(() => expect(click).toHaveBeenCalled());
        expect(created[0]).toBeInstanceOf(Blob);
        expect(await created[0].text()).toContain('circle');
    });

    it('disables FK5 saving without a pixel scale and Save without regions', () => {
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions, imageData: { width: 1, height: 1 } });
        expect(screen.getByText('FK5')).toBeDisabled();
        cleanup();
        renderPluginSlot(initRegionToolbarPlugin, slot, { regions: [], imageData: img });
        expect(screen.getByText('Save').closest('button')).toBeDisabled();
    });
});
