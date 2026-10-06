import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initChecksumPlugin } from '../../src/plugins/ChecksumPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('ChecksumPlugin', () => {
    afterEach(() => cleanup());

    it('disables verification when there is no active FITS HDU', () => {
        renderPluginSlot(initChecksumPlugin, 'menubar:file', { activeHdu: null });
        expect(screen.getByRole('button', { name: /Verify HDU Checksum/i })).toBeDisabled();
    });

    it('verifies the selected HDU and presents both checksum results', async () => {
        const { contextValue } = renderPluginSlot(initChecksumPlugin, 'menubar:file', { activeHdu: 3 });
        const verifyChecksum = vi.spyOn(contextValue.fitsWorker, 'verifyChecksum')
            .mockResolvedValue({ dataOk: 1, headerOk: -1 });

        fireEvent.click(screen.getByRole('button', { name: /Verify HDU Checksum/i }));

        await waitFor(() => expect(verifyChecksum).toHaveBeenCalledWith(3));
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('HDU 3');
        expect(within(dialog).getByText('Data checksum (DATASUM)').nextElementSibling).toHaveTextContent('Verified');
        expect(within(dialog).getByText('Header checksum (CHECKSUM)').nextElementSibling).toHaveTextContent('Verification failed');
    });

    it('reports worker errors instead of presenting them as checksum results', async () => {
        const { contextValue } = renderPluginSlot(initChecksumPlugin, 'menubar:file', { activeHdu: 1 });
        vi.spyOn(contextValue.fitsWorker, 'verifyChecksum').mockRejectedValue(new Error('WASM checksum error'));

        fireEvent.click(screen.getByRole('button', { name: /Verify HDU Checksum/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('WASM checksum error');
    });
});
