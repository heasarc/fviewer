// tests/plugins/DataCubePlugin.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { initDataCubePlugin } from '../../src/plugins/DataCubePlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('DataCubePlugin', () => {
    afterEach(() => { cleanup(); });

    it('should not render anything if the active HDU is a standard 2D image', () => {
        const mockHduList = [
            { index: 1, type: 'image', naxes: [1024, 1024] } // Only 2 dimensions
        ];

        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: mockHduList,
            activeHdu: 1
        });
        
        // The Cube button should NOT be in the document
        expect(screen.queryByTitle('Data Cube Slices')).not.toBeInTheDocument();
    });

    it('should render the Cube dropdown and sliders if the active HDU is a 3D data cube', () => {
        const mockHduList = [
            { index: 1, type: 'image', naxes: [1024, 1024, 50] } // 3 dimensions
        ];

        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: mockHduList,
            activeHdu: 1,
            currentSlice: [1]
        });
        
        expect(screen.getByTitle('Data Cube Slices')).toBeInTheDocument();
        expect(screen.getByText('Z Axis')).toBeInTheDocument();
        // Range input should be present
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('should update currentSlice and readImage when the slider is released', async () => {
        const mockHduList = [{ index: 1, type: 'image', naxes: [1024, 1024, 50] }];
        const mockSetCurrentSlice = vi.fn();
        const mockSetImageData = vi.fn();
        const mockReadImage = vi.fn().mockResolvedValue({ data: new Float32Array(10) });
        
        renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: mockHduList,
            activeHdu: 1,
            currentSlice: [1],
            setCurrentSlice: mockSetCurrentSlice,
            setImageData: mockSetImageData,
            fitsWorker: { readImage: mockReadImage }
        });

        const slider = screen.getByRole('slider');
        
        // 1. Simulate dragging the slider to frame 42
        fireEvent.change(slider, { target: { value: '42' } });
        
        // 2. Simulate releasing the mouse to trigger the fetch
        fireEvent.mouseUp(slider);

        await waitFor(() => {
            expect(mockSetCurrentSlice).toHaveBeenCalledWith([42]);
            expect(mockReadImage).toHaveBeenCalledWith([42]);
            expect(mockSetImageData).toHaveBeenCalled();
        });
    });

    it('should handle Python API command: set_slice', async () => {
        const mockHduList = [{ index: 1, type: 'image', naxes: [1024, 1024, 50] }];
        const mockSetCurrentSlice = vi.fn();
        const mockSetImageData = vi.fn();
        const mockReadImage = vi.fn().mockResolvedValue({ data: new Float32Array(10) });

        const { executeCommand } = renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: mockHduList,
            activeHdu: 1,
            currentSlice: [1],
            setCurrentSlice: mockSetCurrentSlice,
            setImageData: mockSetImageData,
            fitsWorker: { readImage: mockReadImage }
        });

        const mockSendReply = vi.fn();
        await executeCommand({ action: 'set_slice', sliceIndices: [25], message_id: '123' }, mockSendReply);

        expect(mockSetCurrentSlice).toHaveBeenCalledWith([25]);
        expect(mockReadImage).toHaveBeenCalledWith([25]);
        expect(mockSetImageData).toHaveBeenCalled();
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: '123', status: 'ok' });
    });

    it('should handle Python API command: get_slice', async () => {
        const mockHduList = [{ index: 1, type: 'image', naxes: [1024, 1024, 50] }];
        
        const { executeCommand } = renderPluginSlot(initDataCubePlugin, 'fitsimage:toolbar', {
            hduList: mockHduList,
            activeHdu: 1,
            currentSlice: [42] // Current state is frame 42
        });

        const mockSendReply = vi.fn();
        await executeCommand({ action: 'get_slice', message_id: '124' }, mockSendReply);

        // Should reply with the current slice from context
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: '124', sliceIndices: [42] });
    });
});