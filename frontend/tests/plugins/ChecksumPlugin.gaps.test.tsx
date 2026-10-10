import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initChecksumPlugin } from '../../src/plugins/ChecksumPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('ChecksumPlugin gaps', () => {
    afterEach(() => cleanup());

    it('disables for non-FITS data and reports unavailable result', async () => {
        renderPluginSlot(initChecksumPlugin, 'menubar:file', { activeHdu: 1, activeDataType: 'votable' });
        expect(screen.getByRole('button', { name: /Verify HDU Checksum/i })).toBeDisabled();
        cleanup();
        const { contextValue } = renderPluginSlot(initChecksumPlugin, 'menubar:file', { activeHdu: 1 });
        (contextValue.fitsWorker.verifyChecksum as any).mockResolvedValue(null);
        fireEvent.click(screen.getByRole('button', { name: /Verify HDU Checksum/i }));
        expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
    });
});
