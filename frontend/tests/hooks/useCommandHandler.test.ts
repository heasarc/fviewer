import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommandHandler } from '../../src/hooks/useCommandHandler'; // Adjust path as needed

describe('useCommandHandler Hook', () => {
    // 1. Setup mock functions (Spies)
    const mockProcessFile = vi.fn();
    const mockSetColormap = vi.fn();
    const mockSetStretch = vi.fn();
    const mockSetRegions = vi.fn();
    const mockPixToWorld = vi.fn();
    const mockWorldToPix = vi.fn();
    const mockSendReply = vi.fn();

    // Reset spies before each test so counts don't bleed over
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock global fetch for the load_file test
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => new Blob(['dummy fits data']),
        } as Response);
    });

    // Helper to initialize the hook with default mock state
    const setupHook = (regions: any[] = [], colormap = 'gray', stretch = 'linear') => {
        const { result } = renderHook(() => useCommandHandler(
            mockProcessFile,
            colormap, mockSetColormap,
            stretch, mockSetStretch,
            regions, mockSetRegions,
            { width: 100, height: 100, pixScale: { scaleX: 1, scaleY: 1 } }, // Mock imageData
            mockPixToWorld,
            mockWorldToPix
        ));
        return result.current; // This is the handler function
    };

    it('should handle set_colormap and send an ACK', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'set_colormap', cmap: 'plasma', message_id: 'msg_1' }, 
            mockSendReply
        );

        // Verify React state was updated
        expect(mockSetColormap).toHaveBeenCalledWith('plasma');
        // Verify Python client got the OK response
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_1', status: 'ok' });
    });

    it('should handle get_colormap and return the current React state', async () => {
        // Initialize hook with 'heat' colormap
        const handler = setupHook([], 'heat');
        
        await handler(
            { action: 'get_colormap', message_id: 'msg_2' }, 
            mockSendReply
        );

        // Verify Python client got the data
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_2', colormap: 'heat' });
    });

    it('should securely handle load_file and create a File object', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'load_file', path: 'data/my_file.fits', message_id: 'msg_3' }, 
            mockSendReply
        );

        // Verify we triggered a fetch to our secure backend
        expect(globalThis.fetch).toHaveBeenCalled();
        
        // Verify processFile was called with a constructed File object
        expect(mockProcessFile).toHaveBeenCalled();
        const createdFile = mockProcessFile.mock.calls[0][0];
        expect(createdFile).toBeInstanceOf(File);
        expect(createdFile.name).toBe('my_file.fits');

        // Verify the ACK was sent
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_3', status: 'ok' });
    });

    it('should add a basic region securely', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'add_region', type: 'circle', x: 50, y: 50, radius: 10, format: 'image', message_id: 'msg_4' }, 
            mockSendReply
        );

        console.log("Reply was:", mockSendReply.mock.calls[0][0]);

        // mockSetRegions is called with a callback (prev => [...prev, newRegion])
        // We need to execute that callback to see what it tried to add
        expect(mockSetRegions).toHaveBeenCalled();
        
        const stateUpdaterFn = mockSetRegions.mock.calls[0][0];
        const newState = stateUpdaterFn([]); // Provide empty array as 'prev' state
        
        expect(newState).toHaveLength(1);
        expect(newState[0].type).toBe('circle');
        expect(newState[0].startX).toBe(50);
        expect(newState[0].endX).toBe(60); // x + radius
        
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_4', status: 'ok' });
    });

    it('should reject invalid region types', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'add_region', type: 'hacked_type', x: 50, y: 50, message_id: 'msg_5' }, 
            mockSendReply
        );

        // React state should NOT be updated
        expect(mockSetRegions).not.toHaveBeenCalled();
        
        // Python client should instantly get an error
        expect(mockSendReply).toHaveBeenCalledWith({ 
            message_id: 'msg_5', 
            error: 'Invalid region type: hacked_type' 
        });
    });
});