import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommandHandler } from '../../src/hooks/useCommandHandler';
import { commandRegistry } from '../../src/core/CommandRegistry';

describe('useCommandHandler', () => {
    it('forwards commands to the registry and is referentially stable', async () => {
        const spy = vi.spyOn(commandRegistry, 'execute').mockResolvedValue(undefined as any);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { result, rerender } = renderHook(() => useCommandHandler());
        const first = result.current;
        const reply = vi.fn();
        await first({ action: 'x' }, reply);
        expect(spy).toHaveBeenCalledWith({ action: 'x' }, reply);
        rerender();
        expect(result.current).toBe(first);
    });
});
