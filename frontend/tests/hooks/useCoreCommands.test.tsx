// tests/hooks/useCoreCommands.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCoreCommands } from '../../src/hooks/useCoreCommands'; 
import { commandRegistry } from '../../src/core/CommandRegistry'; 

describe('Core Commands Plugin', () => {
    // 1. Setup mock functions (Spies)
    const mockProcessFile = vi.fn();
    const mockSetRegions = vi.fn();
    const mockPixToWorld = vi.fn();
    const mockWorldToPix = vi.fn();
    const mockSendReply = vi.fn();

    let unmountHook: () => void;

    // Reset spies before each test so counts don't bleed over
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock global fetch for the load_file test
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => new Blob(['dummy fits data']),
        } as Response);
    });

    afterEach(() => {
        // Clean up the registry after each test by unmounting the hook
        if (unmountHook) unmountHook();
    });

    // Helper to initialize the hook with default mock state matching the new signature
    const setupHook = (regions: any[] = []) => {
        // Render useCoreCommands so it registers its commands to the registry
        const { unmount } = renderHook(() => useCoreCommands(
            mockProcessFile,
            regions, 
            mockSetRegions,
            { width: 100, height: 100, pixScale: { scaleX: 1, scaleY: 1 } }, // Mock imageData
            mockPixToWorld,
            mockWorldToPix
        ));
        
        unmountHook = unmount;

        // Return the registry's execute function so tests can trigger commands
        return async (command: any, sendReply: any) => {
            await commandRegistry.execute(command, sendReply);
        };
    };

    it('should securely handle load_file and create a File object', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'load_file', path: 'data/my_file.fits', message_id: 'msg_3' }, 
            mockSendReply
        );

        expect(globalThis.fetch).toHaveBeenCalled();
        expect(mockProcessFile).toHaveBeenCalled();
        
        const createdFile = mockProcessFile.mock.calls[0][0];
        expect(createdFile).toBeInstanceOf(File);
        expect(createdFile.name).toBe('my_file.fits');

        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_3', status: 'ok' });
    });

    it('should add a basic region securely', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'add_region', type: 'circle', x: 50, y: 50, radius: 10, format: 'image', message_id: 'msg_4' }, 
            mockSendReply
        );

        expect(mockSetRegions).toHaveBeenCalled();
        
        const stateUpdaterFn = mockSetRegions.mock.calls[0][0];
        const newState = stateUpdaterFn([]); 
        
        expect(newState).toHaveLength(1);
        expect(newState[0].type).toBe('circle');
        expect(newState[0].startX).toBe(50);
        expect(newState[0].endX).toBe(60); 
        
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: 'msg_4', status: 'ok' });
    });

    it('should reject invalid region types', async () => {
        const handler = setupHook();
        
        await handler(
            { action: 'add_region', type: 'hacked_type', x: 50, y: 50, message_id: 'msg_5' }, 
            mockSendReply
        );

        expect(mockSetRegions).not.toHaveBeenCalled();
        
        expect(mockSendReply).toHaveBeenCalledWith({ 
            message_id: 'msg_5', 
            error: 'Invalid region type: hacked_type' 
        });
    });
});