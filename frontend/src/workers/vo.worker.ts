// frontend/src/workers/vo.worker.ts
import { VOCore } from './vo.core';

const core = new VOCore();

self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        const result = await core.processCommand(action, payload);
        
        (self as any).postMessage(
            { id, success: true, data: result.data }, 
            result.transferables || []
        );
    } catch (error: any) {
        self.postMessage({ id, success: false, error: error.message });
    }
};