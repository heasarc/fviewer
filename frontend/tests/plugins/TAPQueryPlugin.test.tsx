import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { initTAPQueryPlugin } from '../../src/plugins/TAPQueryPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const SLOT = 'menubar:menus';
const meta = { metadata: { numRows: 2, numCols: 2, colNames: ['ra', 'dec'] } };
const ok = { ok: true, json: async () => ({ xmlString: '<x/>' }) };

const setup = (over: any = {}) => {
    const fitsWorker = { pixToWorld: vi.fn(async (x: number, y: number) => ({ ra: x, dec: y })) };
    const voWorker = { loadVOTableString: vi.fn().mockResolvedValue(meta) };
    const ctx = {
        fitsWorker, voWorker, setActiveDataType: vi.fn(), setTableInfo: vi.fn(), setActiveHdu: vi.fn(),
        setFileName: vi.fn(), setIsLoading: vi.fn(), ...over,
    };
    return { ...renderPluginSlot(initTAPQueryPlugin, SLOT, ctx), ctx };
};
const lastAdql = () => JSON.parse((fetch as any).mock.calls.at(-1)[1].body).query as string;
const img = { width: 100, height: 50 };
const region = (o: any) => ({ id: 'r1', startX: 10, startY: 10, endX: 20, endY: 10, ...o });

describe('TAPQueryPlugin', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok));
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('renders nothing when disconnected', () => {
        setup({ isConnected: false });
        expect(screen.queryByText('Catalogs')).toBeNull();
    });

    it('runs a manual query, updates state and closes the modal', async () => {
        const { ctx } = setup();
        fireEvent.click(screen.getByText(/Manual ADQL Search/));
        fireEvent.change(screen.getByDisplayValue(/SELECT TOP 100/), { target: { value: 'SELECT 1' } });
        fireEvent.change(screen.getByDisplayValue(/heasarc/), { target: { value: 'http://t/tap' } });
        fireEvent.click(screen.getByText('Run Query'));
        await waitFor(() => expect(ctx.setTableInfo).toHaveBeenCalled());
        expect(ctx.setTableInfo.mock.calls[0][0]).toMatchObject({ numRows: 2, numCols: 2 });
        expect(ctx.setActiveDataType).toHaveBeenCalledWith('votable');
        expect(ctx.setFileName).toHaveBeenCalledWith('Catalog: Manual Query');
        expect(ctx.setActiveHdu).toHaveBeenCalledWith(null);
        expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({ url: 'http://t/tap', query: 'SELECT 1' });
        await waitFor(() => expect(screen.queryByText('Run Query')).toBeNull());
    });

    it('cancels the modal', () => {
        setup();
        fireEvent.click(screen.getByText(/Manual ADQL Search/));
        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByText('Run Query')).toBeNull();
    });

    it('alerts with the server detail on proxy errors', async () => {
        (fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: 'nope' }) });
        setup();
        fireEvent.click(screen.getByText(/Manual ADQL Search/));
        fireEvent.click(screen.getByText('Run Query'));
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Query Failed: nope'));
    });

    it('falls back to the status code when no detail is given', async () => {
        (fetch as any).mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
        setup();
        fireEvent.click(screen.getByText(/Manual ADQL Search/));
        fireEvent.click(screen.getByText('Run Query'));
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Query Failed: Proxy Error: 502'));
    });

    it('does nothing for overlay queries without an image', () => {
        setup();
        fireEvent.click(screen.getByText('HEASARC Chandra'));
        expect(fetch).not.toHaveBeenCalled();
    });

    it('queries the full image footprint and keeps the image displayed', async () => {
        const { ctx } = setup({ imageData: img });
        fireEvent.click(screen.getByText('HEASARC Chandra'));
        await waitFor(() => expect(ctx.setTableInfo).toHaveBeenCalled());
        expect(lastAdql()).toContain('FROM csc WHERE CONTAINS(POINT(\'ICRS\', ra, dec), POLYGON(\'ICRS\', 0, 50, 100, 50, 100, 0, 0, 0)) = 1');
        expect(ctx.setFileName).toHaveBeenCalledWith('Catalog: Chandra Source Catalog');
        expect(ctx.setActiveHdu).not.toHaveBeenCalled();
    });

    it.each([
        ['HEASARC XMM', 'xmmssc'], ['ZTF DR24', 'ztf_objects_dr24'],
    ])('%s overlay targets its table', async (label, table) => {
        setup({ imageData: img });
        fireEvent.click(screen.getByText(label));
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(lastAdql()).toContain(`FROM ${table} WHERE`);
    });

    it.each([
        ['box', { type: 'box', angle: 0, startY: 20, endY: 30 }, /POLYGON\('ICRS', (.*, ){7}.*\)\) = 1/],
        ['ellipse', { type: 'ellipse', endY: 15, angle: 30 }, /POLYGON/],
        ['annulus', { type: 'annulus', innerR: 3 }, /CIRCLE.*= 1 AND CONTAINS.*CIRCLE.*= 0/],
        ['annulus default inner', { type: 'annulus' }, /= 0\)/],
        ['circle', { type: 'circle' }, /CIRCLE\('ICRS', 10, 40, [\d.]+\)\) = 1/],
    ])('builds a %s region query', async (_n, r, pattern) => {
        setup({ imageData: img, regions: [region(r)], selectedRegionId: 'r1' });
        fireEvent.click(screen.getByText('HEASARC XMM'));
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(lastAdql()).toMatch(pattern);
    });

    it('alerts when coordinate conversion fails', async () => {
        const { ctx } = setup({ imageData: img });
        ctx.fitsWorker.pixToWorld.mockRejectedValue(new Error('no wcs'));
        fireEvent.click(screen.getByText('HEASARC Chandra'));
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Context Query Error: no wcs'));
        expect(fetch).not.toHaveBeenCalled();
    });
});
