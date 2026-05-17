import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initImageControlPlugin } from '../../src/plugins/ImageControlPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('ImageControlPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render Colormap and Scale dropdowns', () => {
        renderPluginSlot(initImageControlPlugin, 'fitsimage:toolbar');
        
        expect(screen.getByTitle('Colormap')).toBeInTheDocument();
        expect(screen.getByTitle('Scale / Stretch')).toBeInTheDocument();
    });

    it('should change colormap state when UI button is clicked', () => {
        const mockSetColormap = vi.fn();
        renderPluginSlot(initImageControlPlugin, 'fitsimage:toolbar', {
            setColormap: mockSetColormap
        });

        fireEvent.click(screen.getByText(/Plasma/i));
        expect(mockSetColormap).toHaveBeenCalledWith('plasma');
    });

    it('should handle Python API command: set_colormap', async () => {
        const mockSetColormap = vi.fn();
        const { executeCommand } = renderPluginSlot(initImageControlPlugin, 'fitsimage:toolbar', {
            setColormap: mockSetColormap
        });

        const mockSendReply = vi.fn();
        await executeCommand({ action: 'set_colormap', cmap: 'heat', message_id: '123' }, mockSendReply);

        expect(mockSetColormap).toHaveBeenCalledWith('heat');
        expect(mockSendReply).toHaveBeenCalledWith({ message_id: '123', status: 'ok' });
    });
});