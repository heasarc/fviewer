import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ServerFileModal } from '../../src/components/ServerFileModal';

const listing = {
    current_path: '/data',
    items: [
        { name: 'sub', path: '/data/sub', is_dir: true },
        { name: 'a.fits', path: '/data/a.fits', is_dir: false },
        { name: 'r.REG', path: '/data/r.REG', is_dir: false },
    ],
};

describe('ServerFileModal', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => listing }));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('renders nothing and does not fetch when closed', () => {
        const { container } = render(<ServerFileModal isOpen={false} onClose={vi.fn()} onFileSelect={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('lists directories and hides .reg files in fits mode; selecting closes', async () => {
        const onSelect = vi.fn(), onClose = vi.fn();
        render(<ServerFileModal isOpen mode="fits" onClose={onClose} onFileSelect={onSelect} />);
        expect(await screen.findByText('a.fits')).toBeInTheDocument();
        expect(screen.getByText('sub')).toBeInTheDocument();
        expect(screen.queryByText('r.REG')).toBeNull();
        expect(screen.getByText('Open FITS from Server')).toBeInTheDocument();
        fireEvent.click(screen.getByText('a.fits'));
        expect(onSelect).toHaveBeenCalledWith('/data/a.fits');
        expect(onClose).toHaveBeenCalled();
    });

    it('shows only .reg files in region mode', async () => {
        render(<ServerFileModal isOpen mode="region" onClose={vi.fn()} onFileSelect={vi.fn()} />);
        expect(await screen.findByText('r.REG')).toBeInTheDocument();
        expect(screen.queryByText('a.fits')).toBeNull();
        expect(screen.getByText('Load Region from Server')).toBeInTheDocument();
    });

    it('navigates into a directory', async () => {
        render(<ServerFileModal isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />);
        fireEvent.click(await screen.findByText('sub'));
        await waitFor(() => expect((fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes(encodeURIComponent('/data/sub')))).toBe(true));
    });

    it('survives a failed listing and closes via the X button', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        (fetch as any).mockRejectedValue(new Error('boom'));
        const onClose = vi.fn();
        const { container } = render(<ServerFileModal isOpen onClose={onClose} onFileSelect={vi.fn()} />);
        await waitFor(() => expect(console.error).toHaveBeenCalled());
        fireEvent.click(container.querySelector('.btn-close')!);
        expect(onClose).toHaveBeenCalled();
    });
});
