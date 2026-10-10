import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { initServerFilePlugin } from '../../src/plugins/ServerFilePlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const listing = { current_path: '/d', items: [
    { name: 'a.fits', path: '/d/a.fits', is_dir: false },
    { name: 'r.reg', path: '/d/r.reg', is_dir: false },
] };

const mockFetch = (fileResp: any) => vi.fn().mockImplementation((url: string) =>
    String(url).includes('api/fs/list') ? Promise.resolve({ json: async () => listing }) : Promise.resolve(fileResp));

describe('ServerFilePlugin', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('shows the menu item only when connected and opens the fits modal', () => {
        const setServerModalMode = vi.fn();
        renderPluginSlot(initServerFilePlugin, 'menubar:file', { setServerModalMode });
        fireEvent.click(screen.getByText(/Open From Server/));
        expect(setServerModalMode).toHaveBeenCalledWith('fits');
    });

    it('hides the item when disconnected', () => {
        renderPluginSlot(initServerFilePlugin, 'menubar:file', { isConnected: false });
        expect(screen.queryByText(/Open From Server/)).toBeNull();
    });

    it('downloads a fits file and processes it', async () => {
        vi.stubGlobal('fetch', mockFetch({ ok: true, blob: async () => new Blob(['x']) }));
        const processFile = vi.fn(), setServerModalMode = vi.fn(), setIsLoading = vi.fn();
        renderPluginSlot(initServerFilePlugin, 'menubar:file', { serverModalMode: 'fits', processFile, setServerModalMode, setIsLoading });
        fireEvent.click(await screen.findByText('a.fits'));
        await waitFor(() => expect(processFile).toHaveBeenCalled());
        expect(processFile.mock.calls[0][0].name).toBe('a.fits');
        await waitFor(() => expect(setServerModalMode).toHaveBeenCalledWith(null));
        expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('loads regions in region mode using the physical transform', async () => {
        vi.stubGlobal('fetch', mockFetch({ ok: true, text: async () => 'image\ncircle(10,10,5)\n' }));
        const setRegions = vi.fn();
        renderPluginSlot(initServerFilePlugin, 'menubar:file', {
            serverModalMode: 'region', setRegions,
            imageData: { width: 100, height: 100 },
        });
        fireEvent.click(await screen.findByText('r.reg'));
        await waitFor(() => expect(setRegions).toHaveBeenCalled());
        const updater = setRegions.mock.calls[0][0];
        expect(updater([{ id: 'old' }])[0]).toEqual({ id: 'old' });
    });

    it('alerts when region loading has no image data', async () => {
        vi.stubGlobal('fetch', mockFetch({ ok: true, text: async () => '' }));
        renderPluginSlot(initServerFilePlugin, 'menubar:file', { serverModalMode: 'region', imageData: null });
        fireEvent.click(await screen.findByText('r.reg'));
        await waitFor(() => expect(window.alert).toHaveBeenCalled());
    });

    it('alerts when the download fails', async () => {
        vi.stubGlobal('fetch', mockFetch({ ok: false }));
        const processFile = vi.fn();
        renderPluginSlot(initServerFilePlugin, 'menubar:file', { serverModalMode: 'fits', processFile });
        fireEvent.click(await screen.findByText('a.fits'));
        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to load file from server.'));
        expect(processFile).not.toHaveBeenCalled();
    });
});
