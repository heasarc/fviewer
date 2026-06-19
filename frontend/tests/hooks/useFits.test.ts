// # Copyright 2026, University of Maryland, All Rights Reserved

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// IMPORTANT: Adjust this path to point correctly to your src directory
import { useFits } from '../../src/hooks/useFits'; 

const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();
let currentWorkerInstance: any = null;

// Mock the native Browser Worker API
class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    
    constructor() {
        currentWorkerInstance = this;
    }
    
    postMessage = mockPostMessage;
    terminate = mockTerminate;
}

describe('useFits Hook', () => {
    beforeAll(() => {
        // Intercept the browser's global Worker object
        vi.stubGlobal('Worker', MockWorker);
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        currentWorkerInstance = null;
    });

    it('should initialize the worker on mount and terminate on unmount', () => {
        const { unmount } = renderHook(() => useFits());
        
        // Worker should be instantiated
        expect(currentWorkerInstance).not.toBeNull();
        expect(mockTerminate).not.toHaveBeenCalled();

        // Unmount should trigger terminate
        unmount();
        expect(mockTerminate).toHaveBeenCalledOnce();
    });

    it('should reject if a command is sent before worker initialization', async () => {
        let promise: Promise<any> | null = null;
        
        renderHook(() => {
            const fits = useFits();
            if (!promise) {
                promise = fits.readHeader();
            }
            return fits;
        });

        await expect(promise).rejects.toThrow("Worker not initialized");
    });

    it('should successfully resolve a command when the worker returns success', async () => {
        const { result } = renderHook(() => useFits());

        let promise: Promise<any>;
        act(() => {
            promise = result.current.readHeader();
        });

        // Verify the message was posted
        expect(mockPostMessage).toHaveBeenCalledWith({
            id: 0,
            action: 'READ_HEADER',
            payload: undefined
        });

        // Simulate a successful worker response
        act(() => {
            currentWorkerInstance.onmessage({
                data: { id: 0, success: true, data: { header: 'data' } }
            } as MessageEvent);
        });

        const res = await promise!;
        expect(res).toEqual({ header: 'data' });
    });

    it('should reject a command when the worker returns an error', async () => {
        const { result } = renderHook(() => useFits());

        let promise: Promise<any>;
        act(() => {
            promise = result.current.getHduList();
        });

        // Simulate an error worker response
        act(() => {
            currentWorkerInstance.onmessage({
                data: { id: 0, success: false, error: 'Worker crash' }
            } as MessageEvent);
        });

        await expect(promise!).rejects.toThrow('Worker crash');
    });

    it('should silently ignore messages with unknown IDs', () => {
        const { result } = renderHook(() => useFits());

        act(() => {
            result.current.readHeader();
        });

        // Send a response with an ID that was never registered
        expect(() => {
            act(() => {
                currentWorkerInstance.onmessage({
                    data: { id: 999, success: true, data: 'ghost' }
                } as MessageEvent);
            });
        }).not.toThrow();
    });

    describe('API Payload Mapping', () => {
        it('should format all API wrapper methods correctly', () => {
            const { result } = renderHook(() => useFits());
            const fits = result.current;

            // openFile
            const dummyData = new Uint8Array([1, 2, 3]);
            fits.openFile(dummyData);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'OPEN_FILE', payload: dummyData });

            // moveToHDU
            fits.moveToHDU(2);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'MOVE_TO_HDU', payload: { hduNum: 2 } });

            // getTableInfo
            fits.getTableInfo();
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'GET_TABLE_INFO', payload: undefined });

            // readColumn
            fits.readColumn(5);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'READ_COLUMN', payload: { colNum: 5 } });

            // readTableChunk
            fits.readTableChunk(0, 100);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'READ_TABLE_CHUNK', payload: { startRow: 0, endRow: 100 } });

            // writeCell
            fits.writeCell(1, 2, 42.5);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'WRITE_CELL', payload: { colNum: 1, rowNum: 2, value: 42.5, arrayIndex: undefined } });

            // writeCell with arrayIndex
            fits.writeCell(1, 2, 42.5, 3);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'WRITE_CELL', payload: { colNum: 1, rowNum: 2, value: 42.5, arrayIndex: 3 } });

            // saveFile
            fits.saveFile();
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'SAVE_FILE', payload: undefined });

            // readImage
            fits.readImage();
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'READ_IMAGE', payload: { sliceIndices: undefined } });

            // checkWcs
            fits.checkWcs();
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'CHECK_WCS', payload: undefined });

            // pixToWorld
            fits.pixToWorld(100, 200);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'PIX_TO_WORLD', payload: { x: 100, y: 200 } });

            // worldToPix
            fits.worldToPix(12.5, -45.2);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'WORLD_TO_PIX', payload: { ra: 12.5, dec: -45.2 } });

            // getPixScale
            fits.getPixScale();
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'PIX_SCALE', payload: undefined });

            // updateKeyword
            fits.updateKeyword('BZERO', 0, true, 'Offset');
            expect(mockPostMessage).toHaveBeenLastCalledWith({ id: expect.any(Number), action: 'UPDATE_KEYWORD', payload: { key: 'BZERO', value: 0, isNumeric: true, comment: 'Offset' } });
        });
    });
});