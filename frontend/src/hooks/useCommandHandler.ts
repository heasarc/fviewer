// src/hooks/useCommandHandler.ts
import { useCallback } from 'react';
import { commandRegistry } from '../core/CommandRegistry';

export function useCommandHandler() {
    return useCallback(async (command: any, sendReply: (msg: any) => void) => {
        // Log for debugging
        console.log("Received remote command:", command);
        
        // Pass it to the registry
        await commandRegistry.execute(command, sendReply);
    }, []);
}