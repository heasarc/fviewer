import { describe, it, expect, vi, afterEach } from 'vitest';
import { commandRegistry } from '../../src/core/CommandRegistry';

describe('CommandRegistry gaps', () => {
    afterEach(() => {
        commandRegistry.unregister('boom');
        commandRegistry.unregister('boom_str');
        vi.restoreAllMocks();
    });

    it('replies with the error message when a handler throws an Error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        commandRegistry.register('boom', () => { throw new Error('kaput'); });
        const reply = vi.fn();
        await commandRegistry.execute({ action: 'boom', message_id: 'a' }, reply);
        expect(reply).toHaveBeenCalledWith({ message_id: 'a', error: 'kaput' });
    });

    it('stringifies non-Error throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        commandRegistry.register('boom_str', async () => { throw 'plain'; });
        const reply = vi.fn();
        await commandRegistry.execute({ action: 'boom_str', message_id: 'b' }, reply);
        expect(reply).toHaveBeenCalledWith({ message_id: 'b', error: 'plain' });
    });

    it('replies with an error for unknown commands', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const reply = vi.fn();
        await commandRegistry.execute({ action: 'nope', message_id: 'c' }, reply);
        expect(reply).toHaveBeenCalledWith({ message_id: 'c', error: 'Unknown command: nope' });
    });

    it('warns when overwriting a handler', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        commandRegistry.register('boom', () => {});
        commandRegistry.register('boom', () => {});
        expect(warn).toHaveBeenCalled();
    });
});
