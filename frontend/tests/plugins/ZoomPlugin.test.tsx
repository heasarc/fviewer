import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initZoomPlugin } from '../../src/plugins/ZoomPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('ZoomPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render the Zoom dropdown', () => {
        renderPluginSlot(initZoomPlugin, 'fitsimage:toolbar:right');
        expect(screen.getByTitle('Zoom Menu')).toBeInTheDocument();
    });

    it('should call reset state functions when Reset View is clicked', () => {
        const mockSetZoom = vi.fn();
        const mockSetPan = vi.fn();
        const mockSetRotation = vi.fn();
        
        renderPluginSlot(initZoomPlugin, 'fitsimage:toolbar:right', {
            setZoom: mockSetZoom,
            setPan: mockSetPan,
            setRotation: mockSetRotation
        });

        fireEvent.click(screen.getByText(/Reset View/i));
        
        expect(mockSetZoom).toHaveBeenCalledWith(1);
        expect(mockSetPan).toHaveBeenCalledWith({ x: 0, y: 0 });
        expect(mockSetRotation).toHaveBeenCalledWith(0);
    });
});