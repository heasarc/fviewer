// # Copyright 2026, University of Maryland, All Rights Reserved

import { useEffect, useRef, useCallback } from 'react';

// Vite specific import for web workers
import FitsWorker from '../fits.worker?worker';

interface WorkerResponse {
    id: number;
    success: boolean;
    data?: any;
    error?: string;
}

export function useFits() {
    const workerRef = useRef<Worker | null>(null);
    const messageIdRef = useRef(0);
    const callbacksRef = useRef<Map<number, { resolve: Function, reject: Function }>>(new Map());

    useEffect(() => {
        // Initialize the worker when the app starts
        workerRef.current = new FitsWorker();

        workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const { id, success, data, error } = e.data;
            const callback = callbacksRef.current.get(id);
            
            if (callback) {
                if (success) callback.resolve(data);
                else callback.reject(new Error(error));
                callbacksRef.current.delete(id);
            }
        };

        return () => {
            workerRef.current?.terminate(); // Cleanup on unmount
        };
    }, []);

    // Generic function to send a command and wait for the Promise to resolve
    const sendCommand = useCallback((action: string, payload?: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) return reject(new Error("Worker not initialized"));

            const id = messageIdRef.current++;
            callbacksRef.current.set(id, { resolve, reject });
            
            workerRef.current.postMessage({ id, action, payload });
        });
    }, []);

    // Specific API methods for the React components to use
    const openFile = useCallback((fileData: Uint8Array) => sendCommand('OPEN_FILE', fileData), [sendCommand]);
    const readHeader = useCallback(() => sendCommand('READ_HEADER'), [sendCommand]);
    const getHduList = useCallback(() => sendCommand('GET_HDU_LIST'), [sendCommand]);
    const moveToHDU = useCallback((hduNum: number) => sendCommand('MOVE_TO_HDU', { hduNum }), [sendCommand]);
    const getTableInfo = useCallback(() => sendCommand('GET_TABLE_INFO'), [sendCommand]);
    const readColumn = useCallback((colNum: number) => sendCommand('READ_COLUMN', { colNum }), [sendCommand]);
    const readTableChunk = useCallback((startRow: number, endRow: number) => {
        return sendCommand('READ_TABLE_CHUNK', { startRow, endRow });
    }, [sendCommand]);
    const writeCell = useCallback((colNum: number, rowNum: number, value: number) => {
        return sendCommand('WRITE_CELL', { colNum, rowNum, value });
    }, [sendCommand]);
    const saveFile = useCallback(() => sendCommand('SAVE_FILE'), [sendCommand]);
    const readImage = useCallback(() => sendCommand('READ_IMAGE'), [sendCommand]);
    const checkWcs = useCallback(() => sendCommand('CHECK_WCS'), [sendCommand]);
    const pixToWorld = useCallback((x: number, y: number) => sendCommand('PIX_TO_WORLD', { x, y }), [sendCommand]);
    const worldToPix = useCallback((x: number, y: number) => sendCommand('WORLD_TO_PIX', { x, y }), [sendCommand]);
    const updateKeyword = useCallback((key: string, value: string | number, isNumeric: boolean, comment?: string) => {
        return sendCommand('UPDATE_KEYWORD', { key, value, isNumeric, comment });
    }, [sendCommand]);

    return { 
        openFile, readHeader, getHduList, moveToHDU, getTableInfo, readColumn, writeCell, 
        saveFile, readImage, checkWcs, pixToWorld, worldToPix, updateKeyword, readTableChunk
    };
}