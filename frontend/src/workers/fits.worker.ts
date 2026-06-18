// frontend/workers/src/fits.worker.ts
import { FitsCore } from './fits.core';

const core = new FitsCore();

self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        const result = await core.processCommand(action, payload);
        
        (self as any).postMessage(
            { id, success: true, data: result.data }, 
            result.transferables || []
        );
    } catch (error: any) {
        let errorMsg = "Unknown WASM Error";
        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === 'string') {
            errorMsg = error;
        } else if (error && typeof error === 'object') {
            errorMsg = error.message || JSON.stringify(error);
        }
        self.postMessage({ id, success: false, error: errorMsg });
    }
};