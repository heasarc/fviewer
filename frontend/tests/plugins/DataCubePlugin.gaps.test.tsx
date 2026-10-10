import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initDataCubePlugin } from '../../src/plugins/DataCubePlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const cube4 = [{ index: 1, type: 'image', naxes: [10, 10, 5, 3] }];

describe('DataCubePlugin gaps', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('hides for tables, missing HDUs and missing naxes', () => {
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', { hduList: [{ index: 1, type: 'table', naxes: [1, 2, 3] }], activeHdu: 1 });
        expect(screen.queryByTitle('Data Cube Slices')).toBeNull();
        cleanup();
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', { hduList: [], activeHdu: 1 });
        expect(screen.queryByTitle('Data Cube Slices')).toBeNull();
        cleanup();
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', { hduList: [{ index: 1, type: 'image' }], activeHdu: 1 });
        expect(screen.queryByTitle('Data Cube Slices')).toBeNull();
    });

    it('renders Z and W sliders for 4D, defaulting to 1, and edits the second dimension', async () => {
        const setCurrentSlice = vi.fn();
        const readImage = vi.fn().mockResolvedValue({});
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: cube4, activeHdu: 1, currentSlice: [], setCurrentSlice, setImageData: vi.fn(), fitsWorker: { readImage },
        });
        expect(screen.getByText('Z Axis')).toBeInTheDocument();
        expect(screen.getByText('W Axis')).toBeInTheDocument();
        const [, w] = screen.getAllByRole('slider');
        fireEvent.change(w, { target: { value: '2' } });
        fireEvent.touchEnd(w);
        await waitFor(() => expect(readImage).toHaveBeenCalledWith([undefined, 2]));
    });

    it('renders "Dim N" label for 5D cubes', () => {
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: [{ index: 1, type: 'image', naxes: [4, 4, 2, 2, 2] }], activeHdu: 1, currentSlice: [1, 1, 1],
        });
        expect(screen.getByText('Dim 5 Axis')).toBeInTheDocument();
    });

    it('logs errors when slider release fails', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: cube4, activeHdu: 1, currentSlice: [1, 1], fitsWorker: { readImage: vi.fn().mockRejectedValue(new Error('x')) },
        });
        fireEvent.mouseUp(screen.getAllByRole('slider')[0]);
        await waitFor(() => expect(err).toHaveBeenCalledWith('Failed to read image slice:', expect.any(Error)));
    });

    it('set_slice API logs read errors but still acks; no sliceIndices still acks; get_slice replies', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { executeCommand } = renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: cube4, activeHdu: 1, currentSlice: [3, 2], setCurrentSlice: vi.fn(),
            fitsWorker: { readImage: vi.fn().mockRejectedValue(new Error('bad')) },
        });
        const reply = vi.fn();
        await executeCommand({ action: 'set_slice', message_id: 'a', sliceIndices: [2, 2] }, reply);
        expect(err).toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith({ message_id: 'a', status: 'ok' });
        const reply2 = vi.fn();
        await executeCommand({ action: 'set_slice', message_id: 'b' }, reply2);
        expect(reply2).toHaveBeenCalledWith({ message_id: 'b', status: 'ok' });
        const reply3 = vi.fn();
        await executeCommand({ action: 'get_slice', message_id: 'c' }, reply3);
        expect(reply3).toHaveBeenCalledWith({ message_id: 'c', sliceIndices: [3, 2] });
    });
});
