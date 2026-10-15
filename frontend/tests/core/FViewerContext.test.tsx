// # Copyright 2026, University of Maryland, All Rights Reserved
// tests/core/FViewerContext.test.tsx

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FViewerProvider, useCore } from '../../src/core/FViewerContext';

// --- Mocks ---
vi.mock('../../src/hooks/useFits', () => ({
    useFits: vi.fn(() => ({
        openFile: vi.fn().mockResolvedValue(undefined),
        getHduList: vi.fn().mockResolvedValue([])
    }))
}));

vi.mock('../../src/hooks/useVOTable', () => ({
    useVOTable: vi.fn(() => ({}))
}));

vi.mock('../../src/hooks/useRegions', () => ({
    useRegions: vi.fn((_setRegions) => ({
        drawMode: 'pan',
        setDrawMode: vi.fn(),
        draftRegion: null,
        setDraftRegion: vi.fn(),
        selectedRegionId: null,
        setSelectedRegionId: vi.fn(),
        hoveredRegionId: null,
        setHoveredRegionId: vi.fn(),
        dragAction: null,
        setDragAction: vi.fn(),
        deleteSelectedRegion: vi.fn(),
        handleRegionDrag: vi.fn(),
    }))
}));

vi.mock('../../src/utils/constants', () => ({
    ALLOWED_EXTS: ['.fits', '.fits.gz', '.fit', '.fit.gz'],
    FITS_FORMATS: '.fits, .fits.gz'
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FViewerProvider>{children}</FViewerProvider>
);

describe('FViewerContext', () => {
    let originalAlert: typeof window.alert;
    let originalConsoleError: typeof console.error;
    let originalResponse: typeof globalThis.Response;

    beforeEach(() => {
        originalAlert = window.alert;
        originalConsoleError = console.error;
        originalResponse = globalThis.Response;
        
        window.alert = vi.fn();
        console.error = vi.fn();
    });

    afterEach(() => {
        window.alert = originalAlert;
        console.error = originalConsoleError;
        globalThis.Response = originalResponse;
        vi.clearAllMocks();
    });

    it('should throw an error if useCore is called outside of FViewerProvider', () => {
        // Suppress React's expected error boundary console log for this specific test
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        expect(() => renderHook(() => useCore())).toThrow("useCore must be used within a FViewerProvider");
        
        spy.mockRestore();
    });

    it('should initialize with default states and allow updates', () => {
        const { result } = renderHook(() => useCore(), { wrapper });

        expect(result.current.activeDataType).toBe('fits');
        expect(result.current.fileName).toBe('No file loaded');
        expect(result.current.isConnected).toBe(false);

        act(() => {
            result.current.setActiveDataType('votable');
            result.current.setIsConnected(true);
        });

        expect(result.current.activeDataType).toBe('votable');
        expect(result.current.isConnected).toBe(true);
    });

    describe('processFile', () => {
        it('should reject content that is not valid FITS based on header bytes, regardless of filename extension', async () => {
            const { result } = renderHook(() => useCore(), { wrapper });
            const payload = new Uint8Array(80).fill(0x20);
            payload.set(new TextEncoder().encode('NOT FITS DATA'), 0);

            const badFile = {
                name: 'image.jpg',
                slice: vi.fn((start: number, end: number) => {
                    const bytes = start === 0 && end === 2 ? Uint8Array.from([0x00, 0x00]) : payload;
                    return {
                        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
                    };
                }),
                arrayBuffer: vi.fn()
            } as unknown as File;

            await act(async () => {
                await result.current.processFile(badFile);
            });

            expect(result.current.feedback).toMatchObject({
                type: 'error',
                message: expect.stringContaining('missing SIMPLE=T signature')
            });
            expect(result.current.isLoading).toBe(false);
            expect(vi.mocked(result.current.fitsWorker.openFile)).not.toHaveBeenCalled();
        });

        it('should sanitize state, load a FITS file by signature rather than extension, and find the first valid HDU', async () => {
            const { result } = renderHook(() => useCore(), { wrapper });
            
            // 1. Mess up the state beforehand to ensure sanitization wipes it
            act(() => {
                result.current.setActiveDataType('votable');
                result.current.setActiveHdu(99);
                result.current.setImageData({ data: 'mock' });
            });

            const header = new TextEncoder().encode('SIMPLE  =                    T');
            const goodFile = {
                name: 'test.bin',
                slice: vi.fn((start: number, end: number) => {
                    const bytes = start === 0 && end === 2 ? Uint8Array.from([0x00, 0x00]) : new Uint8Array(header);
                    return {
                        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
                    };
                }),
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
            } as unknown as File;

            const mockOpenFile = vi.mocked(result.current.fitsWorker.openFile);
            const mockGetHduList = vi.mocked(result.current.fitsWorker.getHduList);
            
            // Mock returning a list where index 1 is empty, but index 2 is an image
            mockGetHduList.mockResolvedValue([
                { index: 1, type: 'empty' },
                { index: 2, type: 'image' }
            ]);

            await act(async () => {
                await result.current.processFile(goodFile);
            });

            // Assert state sanitization
            expect(result.current.activeDataType).toBe('fits');
            expect(result.current.imageData).toBeNull();
            
            // Assert worker calls
            expect(goodFile.arrayBuffer).toHaveBeenCalled();
            expect(mockOpenFile).toHaveBeenCalled();
            
            // Assert HDU selection logic
            expect(result.current.activeHdu).toBe(2); 
            expect(result.current.isLoading).toBe(false);
        });

        it('should fallback to activeHdu = 1 if all HDUs are empty', async () => {
            const { result } = renderHook(() => useCore(), { wrapper });
            const header = new TextEncoder().encode('SIMPLE  =                    T');
            const file = {
                name: 'empty.bin',
                slice: vi.fn((start: number, end: number) => {
                    const bytes = start === 0 && end === 2 ? Uint8Array.from([0x00, 0x00]) : new Uint8Array(header);
                    return {
                        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
                    };
                }),
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
            } as unknown as File;
            
            vi.mocked(result.current.fitsWorker.getHduList).mockResolvedValue([
                { index: 0, type: 'empty' }
            ]);

            await act(async () => {
                await result.current.processFile(file);
            });

            expect(result.current.activeHdu).toBe(1); // Fallback applied
        });

        it('should catch errors during processing, set feedback, and clear isLoading', async () => {
            const { result } = renderHook(() => useCore(), { wrapper });
            const header = new TextEncoder().encode('SIMPLE  =                    T');
            const corruptFile = { 
                name: 'corrupt.bin',
                slice: vi.fn((start: number, end: number) => {
                    const bytes = start === 0 && end === 2 ? Uint8Array.from([0x00, 0x00]) : new Uint8Array(header);
                    return {
                        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
                    };
                }),
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
            } as unknown as File;

            const error = new Error('WASM Memory Access Out of Bounds');
            vi.mocked(result.current.fitsWorker.openFile).mockRejectedValue(error);

            await act(async () => {
                await result.current.processFile(corruptFile);
            });

            expect(console.error).toHaveBeenCalledWith('Failed to load file:', error);
            expect(result.current.feedback).toMatchObject({
                type: 'error',
                message: 'Failed to load FITS file.'
            });
            expect(result.current.isLoading).toBe(false); // Ensure finally block executed
        });
    });
});