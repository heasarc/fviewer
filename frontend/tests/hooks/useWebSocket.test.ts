// # Copyright 2026, University of Maryland, All Rights Reserved

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getBasePath, getApiUrl, getWebSocketUrl, useWebSocket } from '../../src/hooks/useWebSocket';

// --- Mocks ---

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    url: string;
    readyState: number = MockWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: any) => void) | null = null;
    send = vi.fn();
    close = vi.fn();

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
    }
}

describe('useWebSocket File', () => {
    beforeAll(() => {
        // Stub the global WebSocket object
        vi.stubGlobal('WebSocket', MockWebSocket);
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        MockWebSocket.instances = [];
    });

    describe('URL Generators', () => {
        // Since Chromium locks window.location, we can't easily stub it. 
        // Instead, we assert that the functions correctly parse the ACTUAL window.location.
        
        it('getBasePath should append a trailing slash if missing, or keep it if present', () => {
            const path = window.location.pathname;
            const expected = path.endsWith('/') ? path : path + '/';
            expect(getBasePath()).toBe(expected);
        });

        it('getApiUrl should correctly append endpoints to the base path', () => {
            const expectedPath = getBasePath() + 'api/test';
            expect(getApiUrl('api/test')).toBe(expectedPath);
        });

        it('getWebSocketUrl should format the ws:// or wss:// url correctly', () => {
            const wsUrl = getWebSocketUrl('client-123');
            
            // Should start with wss: if https, otherwise ws:
            const expectedProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            expect(wsUrl.startsWith(expectedProtocol)).toBe(true);
            
            // Should contain the host, base path, and client ID
            expect(wsUrl).toContain(window.location.host);
            expect(wsUrl).toContain(getBasePath());
            expect(wsUrl).toContain('/ws/client-123');
        });
    });

    describe('useWebSocket Hook', () => {
        it('should initialize connection and return clientId', () => {
            const onCommand = vi.fn();
            const { result } = renderHook(() => useWebSocket(onCommand));

            expect(result.current.clientId).toBeTypeOf('string');
            expect(result.current.isConnected).toBe(false);
            
            // Ensure the mock captured the instantiation
            expect(MockWebSocket.instances.length).toBe(1);
            
            const ws = MockWebSocket.instances[0];
            
            // Assert it creates a proper WebSocket URL containing the generated ID
            expect(ws.url).toContain(`/ws/${result.current.clientId}`);
            expect(ws.url).toMatch(/^wss?:\/\//); // Must start with ws:// or wss://
        });

        it('should update isConnected state on open and close', () => {
            const { result } = renderHook(() => useWebSocket(vi.fn()));
            const ws = MockWebSocket.instances[0];

            act(() => {
                ws.onopen?.();
            });
            expect(result.current.isConnected).toBe(true);

            act(() => {
                ws.onclose?.();
            });
            expect(result.current.isConnected).toBe(false);
        });

        it('should trigger onCommand when a message is received', () => {
            const onCommand = vi.fn();
            renderHook(() => useWebSocket(onCommand));
            const ws = MockWebSocket.instances[0];

            act(() => {
                ws.onmessage?.({ data: JSON.stringify({ type: 'TEST_COMMAND' }) });
            });

            expect(onCommand).toHaveBeenCalledTimes(1);
            expect(onCommand).toHaveBeenCalledWith(
                { type: 'TEST_COMMAND' }, 
                expect.any(Function)
            );
        });

        it('should send a reply if readyState is OPEN', () => {
            const onCommand = vi.fn((_cmd, sendReply) => {
                sendReply({ status: 'success' });
            });
            renderHook(() => useWebSocket(onCommand));
            const ws = MockWebSocket.instances[0];
            
            ws.readyState = MockWebSocket.OPEN;

            act(() => {
                ws.onmessage?.({ data: '{"cmd": "ping"}' });
            });

            expect(ws.send).toHaveBeenCalledTimes(1);
            expect(ws.send).toHaveBeenCalledWith('{"status":"success"}');
        });

        it('should NOT send a reply if readyState is NOT OPEN', () => {
            const onCommand = vi.fn((_cmd, sendReply) => {
                sendReply({ status: 'success' });
            });
            renderHook(() => useWebSocket(onCommand));
            const ws = MockWebSocket.instances[0];
            
            ws.readyState = MockWebSocket.CONNECTING;

            act(() => {
                ws.onmessage?.({ data: '{"cmd": "ping"}' });
            });

            expect(ws.send).not.toHaveBeenCalled();
        });

        it('should keep latest callback without recreating WebSocket connection', () => {
            const firstCallback = vi.fn();
            const secondCallback = vi.fn();
            
            const { rerender } = renderHook(
                ({ cb }) => useWebSocket(cb), 
                { initialProps: { cb: firstCallback } }
            );
            
            const ws = MockWebSocket.instances[0];

            rerender({ cb: secondCallback });

            expect(MockWebSocket.instances.length).toBe(1);

            act(() => {
                ws.onmessage?.({ data: '{"cmd": "test"}' });
            });

            expect(firstCallback).not.toHaveBeenCalled();
            expect(secondCallback).toHaveBeenCalledTimes(1);
        });

        it('should close the WebSocket on unmount', () => {
            const { unmount } = renderHook(() => useWebSocket(vi.fn()));
            
            // Grab reference BEFORE unmounting
            const ws = MockWebSocket.instances[0];
            expect(ws).toBeDefined();

            unmount();
            expect(ws.close).toHaveBeenCalledTimes(1);
        });
    });
});