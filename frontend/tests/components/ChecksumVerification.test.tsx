import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChecksumVerification } from '../../src/components/ChecksumVerification';
import { FViewerContext } from '../../src/core/FViewerContext';
import { createMockContext } from '../utils/PluginTestWrapper';

const mount = (over: any = {}) => {
    const ctx = createMockContext({ activeHdu: 2, ...over });
    render(
        <FViewerContext.Provider value={ctx as any}>
            <ul><ChecksumVerification /></ul>
        </FViewerContext.Provider>
    );
    return ctx;
};
const btn = () => screen.getByRole('button', { name: /Verify|Verifying/i });

describe('ChecksumVerification', () => {
    afterEach(() => cleanup());

    it('is disabled when loading, non-fits, or no HDU', () => {
        mount({ isLoading: true });
        expect(btn()).toBeDisabled();
        cleanup();
        mount({ activeDataType: 'votable' });
        expect(btn()).toBeDisabled();
        cleanup();
        mount({ activeHdu: null });
        expect(btn()).toBeDisabled();
    });

    it('does nothing when clicked with no active HDU', () => {
        const ctx = mount({ activeHdu: null });
        fireEvent.click(btn());
        expect(ctx.fitsWorker.verifyChecksum).not.toHaveBeenCalled();
    });

    it('shows every status label and closes via button, backdrop; dialog click does not close', async () => {
        const ctx = mount();
        ctx.fitsWorker.verifyChecksum.mockResolvedValue({ dataOk: 0, headerOk: 7 });
        fireEvent.click(btn());
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Checksum keyword not present');
        expect(dialog).toHaveTextContent('Unexpected status (7)');

        fireEvent.click(dialog);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByLabelText('Close'));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

        fireEvent.click(btn());
        const d2 = await screen.findByRole('dialog');
        fireEvent.click(d2.parentElement!);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('shows unavailable message when result is null', async () => {
        const ctx = mount();
        ctx.fitsWorker.verifyChecksum.mockResolvedValue(null);
        fireEvent.click(btn());
        expect(await screen.findByText(/unavailable for this HDU/)).toBeInTheDocument();
    });

    it('shows verifying state while pending', async () => {
        const ctx = mount();
        let resolve!: (v: any) => void;
        ctx.fitsWorker.verifyChecksum.mockReturnValue(new Promise(r => { resolve = r; }));
        fireEvent.click(btn());
        expect(await screen.findByText(/Verifying Checksum/)).toBeInTheDocument();
        expect(btn()).toBeDisabled();
        resolve({ dataOk: 1, headerOk: 1 });
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('stringifies non-Error rejections and closes the alert', async () => {
        const ctx = mount();
        ctx.fitsWorker.verifyChecksum.mockRejectedValue('boom');
        fireEvent.click(btn());
        expect(await screen.findByRole('alert')).toHaveTextContent('boom');
        fireEvent.click(screen.getByLabelText('Close'));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
});
