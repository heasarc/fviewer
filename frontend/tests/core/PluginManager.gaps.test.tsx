import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { pluginManager, ExtensionSlot } from '../../src/core/PluginManager';

describe('PluginManager', () => {
    it('returns an empty list for unknown slots', () => {
        expect(pluginManager.getComponents('missing-slot')).toEqual([]);
    });

    it('registers components in order and accumulates them', () => {
        pluginManager.registerUI('s1', <span>a</span>);
        pluginManager.registerUI('s1', <span>b</span>);
        expect(pluginManager.getComponents('s1')).toHaveLength(2);
    });

    it('ExtensionSlot renders nothing for an empty slot', () => {
        const { container } = render(<ExtensionSlot name="empty-slot" />);
        expect(container.innerHTML).toBe('');
    });

    it('ExtensionSlot renders all registered components', () => {
        pluginManager.registerUI('s2', <span data-testid="x">x</span>);
        pluginManager.registerUI('s2', <span data-testid="y">y</span>);
        const { getByTestId } = render(<ExtensionSlot name="s2" />);
        expect(getByTestId('x')).toBeTruthy();
        expect(getByTestId('y')).toBeTruthy();
    });
});
