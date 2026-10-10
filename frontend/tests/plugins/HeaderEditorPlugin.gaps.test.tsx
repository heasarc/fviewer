import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initHeaderEditorPlugin } from '../../src/plugins/HeaderEditorPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const card = (k: string, v: string) => `${k.padEnd(8)}= ${v}`.padEnd(80);

describe('HeaderEditorPlugin gaps', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('logs an error when readHeader fails', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const readHeader = vi.fn().mockRejectedValue(new Error('nope'));
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit', { activeHdu: 1, fitsWorker: { readHeader } });
        await waitFor(() => expect(err).toHaveBeenCalled());
    });

    it('does not read the header without an active HDU', () => {
        const readHeader = vi.fn();
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit', { activeHdu: null, fitsWorker: { readHeader } });
        expect(readHeader).not.toHaveBeenCalled();
    });

    it('adds a keyword through the modal, updates and refreshes header, and closes', async () => {
        const readHeader = vi.fn()
            .mockResolvedValueOnce(card('SIMPLE', 'T'))
            .mockResolvedValue(card('SIMPLE', 'T') + card('FOO', '1'));
        const updateKeyword = vi.fn().mockResolvedValue(undefined);
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit', { activeHdu: 1, fitsWorker: { readHeader, updateKeyword } });
        await waitFor(() => expect(readHeader).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: /Edit Header/i }));
        fireEvent.click(await screen.findByText('New Keyword'));
        fireEvent.change(screen.getByPlaceholderText('KEYWORD'), { target: { value: 'foo' } });
        fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: '1' } });
        fireEvent.click(screen.getByText('Add'));
        await waitFor(() => expect(updateKeyword).toHaveBeenCalledWith('FOO', '1', false, ''));
        await waitFor(() => expect(readHeader).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('FOO')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle(/Close/));
        await waitFor(() => expect(screen.queryByText('FOO')).toBeNull());
    });
});
