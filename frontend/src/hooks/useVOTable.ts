import { useEffect, useRef, useCallback } from 'react';
import VOWorker from '../workers/vo.worker?worker';

interface WorkerResponse {
    id: number;
    success: boolean;
    data?: any;
    error?: string;
}

export function useVOTable() {
    const workerRef = useRef<Worker | null>(null);
    const messageIdRef = useRef(0);
    const callbacksRef = useRef<Map<number, { resolve: Function, reject: Function }>>(new Map());

    useEffect(() => {
        workerRef.current = new VOWorker();

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
            workerRef.current?.terminate();
        };
    }, []);

    const sendCommand = useCallback((action: string, payload?: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) return reject(new Error("Worker not initialized"));

            const id = messageIdRef.current++;
            callbacksRef.current.set(id, { resolve, reject });
            
            workerRef.current.postMessage({ id, action, payload });
        });
    }, []);

    const loadVOTableString = useCallback((xmlString: string) => {
        return sendCommand('LOAD_VOTABLE_STRING', { xmlString });
    }, [sendCommand]);

    const readTableChunk = useCallback((startRow: number, endRow: number) => {
        return sendCommand('READ_TABLE_CHUNK', { startRow, endRow });
    }, [sendCommand]);

    const readColumn = useCallback((colNum: number, colName?: string) => {
        return sendCommand('READ_COLUMN', { colNum, colName });
    }, [sendCommand]);

    return { 
        loadVOTableString, 
        readTableChunk, 
        readColumn 
    };
}