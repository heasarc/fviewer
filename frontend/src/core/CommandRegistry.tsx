// src/core/CommandRegistry.ts

export type CommandPayload = any;
export type SendReplyFn = (msg: any) => void;
export type CommandHandler = (command: CommandPayload, sendReply: SendReplyFn) => Promise<void> | void;

class CommandRegistry {
    private handlers = new Map<string, CommandHandler>();

    // Plugins and Core use this to add new commands
    register(action: string, handler: CommandHandler) {
        if (this.handlers.has(action)) {
            console.warn(`[CommandRegistry] Overwriting command handler for: ${action}`);
        }
        this.handlers.set(action, handler);
    }

    // Allows cleanup on unmount
    unregister(action: string) {
        this.handlers.delete(action);
    }

    // The WebSocket listener calls this
    async execute(command: CommandPayload, sendReply: SendReplyFn) {
        const handler = this.handlers.get(command.action);
        if (handler) {
            try {
                await handler(command, sendReply);
            } catch (error) {
                console.error(`[CommandRegistry] Error in ${command.action}:`, error);
                sendReply({ 
                    message_id: command.message_id, 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        } else {
            console.warn(`[CommandRegistry] Unknown command: ${command.action}`);
            sendReply({ message_id: command.message_id, error: `Unknown command: ${command.action}` });
        }
    }
}

// Export a single instance to be shared across the app
export const commandRegistry = new CommandRegistry();