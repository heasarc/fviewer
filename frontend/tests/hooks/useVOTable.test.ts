// # Copyright 2026, University of Maryland, All Rights Reserved

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// IMPORTANT: Adjust this path to point correctly to your src directory
import { useVOTable } from '../../src/hooks/useVOTable';

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

describe('useVOTable Hook', () => {
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
        const { unmount } = renderHook(() => useVOTable());
        
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
            const vo = useVOTable();
            if (!promise) {
                promise = vo.loadVOTableString('<VOTABLE></VOTABLE>');
            }
            return vo;
        });

        await expect(promise).rejects.toThrow("Worker not initialized");
    });

    it('should successfully resolve a command when the worker returns success', async () => {
        const { result } = renderHook(() => useVOTable());

        let promise: Promise<any>;
        act(() => {
            promise = result.current.readTableChunk(0, 100);
        });

        // Verify the message was posted
        expect(mockPostMessage).toHaveBeenCalledWith({
            id: 0,
            action: 'READ_TABLE_CHUNK',
            payload: { startRow: 0, endRow: 100 }
        });

        // Simulate a successful worker response
        act(() => {
            currentWorkerInstance.onmessage({
                data: { id: 0, success: true, data: { rows: [] } }
            } as MessageEvent);
        });

        const res = await promise!;
        expect(res).toEqual({ rows: [] });
    });

    it('should reject a command when the worker returns an error', async () => {
        const { result } = renderHook(() => useVOTable());

        let promise: Promise<any>;
        act(() => {
            promise = result.current.readColumn(1);
        });

        // Simulate an error worker response
        act(() => {
            currentWorkerInstance.onmessage({
                data: { id: 0, success: false, error: 'Parse error' }
            } as MessageEvent);
        });

        await expect(promise!).rejects.toThrow('Parse error');
    });

    it('should silently ignore messages with unknown IDs', () => {
        const { result } = renderHook(() => useVOTable());

        act(() => {
            result.current.readColumn(1);
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
            const { result } = renderHook(() => useVOTable());
            const vo = result.current;

            // loadVOTableString
            vo.loadVOTableString('<VOTABLE>data</VOTABLE>');
            expect(mockPostMessage).toHaveBeenLastCalledWith({ 
                id: expect.any(Number), 
                action: 'LOAD_VOTABLE_STRING', 
                payload: { xmlString: '<VOTABLE>data</VOTABLE>' } 
            });

            // readTableChunk
            vo.readTableChunk(50, 150);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ 
                id: expect.any(Number), 
                action: 'READ_TABLE_CHUNK', 
                payload: { startRow: 50, endRow: 150 } 
            });

            // readColumn (without colName)
            vo.readColumn(2);
            expect(mockPostMessage).toHaveBeenLastCalledWith({ 
                id: expect.any(Number), 
                action: 'READ_COLUMN', 
                payload: { colNum: 2, colName: undefined } 
            });

            // readColumn (with colName)
            vo.readColumn(3, 'RA');
            expect(mockPostMessage).toHaveBeenLastCalledWith({ 
                id: expect.any(Number), 
                action: 'READ_COLUMN', 
                payload: { colNum: 3, colName: 'RA' } 
            });
        });
    });
});