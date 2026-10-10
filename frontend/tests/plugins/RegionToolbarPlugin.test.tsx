import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initRegionToolbarPlugin } from '../../src/plugins/RegionToolbarPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('RegionToolbarPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render the Regions dropdown', () => {
        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left');
        expect(screen.getByTitle('Regions Menu')).toBeInTheDocument();
    });

    it('should change drawMode when a shape is selected', () => {
        const mockSetDrawMode = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left', {
            setDrawMode: mockSetDrawMode
        });

        // Click the Circle tool
        fireEvent.click(screen.getByText(/Circle/i));
        expect(mockSetDrawMode).toHaveBeenCalledWith('circle');
    });

    it('should show the active draw mode and allow returning to pan', () => {
        const mockSetDrawMode = vi.fn();
        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left', {
            drawMode: 'circle',
            setDrawMode: mockSetDrawMode
        });

        expect(screen.getByTestId('draw-mode-label')).toHaveTextContent('Draw: Circle');
        fireEvent.click(screen.getByTitle(/Return to Pointer/i));
        expect(mockSetDrawMode).toHaveBeenCalledWith('pan');
    });

    it('should return to pan on Escape and hide Pan button in pan mode', () => {
        const mockSetDrawMode = vi.fn();
        const { unmount } = renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left', {
            drawMode: 'box',
            setDrawMode: mockSetDrawMode
        }) as any;
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockSetDrawMode).toHaveBeenCalledWith('pan');
        unmount?.();
        cleanup();

        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left', { drawMode: 'pan' });
        expect(screen.queryByTitle(/Return to Pointer/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('draw-mode-label')).toHaveTextContent('Regions');
    });

    it('should close the dropdown after a selection', () => {
        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left');
        const toggle = screen.getByTitle('Regions Menu');
        const toggleClick = vi.spyOn(toggle, 'click');
        toggle.setAttribute('aria-expanded', 'true');

        fireEvent.click(screen.getByText(/Circle/i));
        expect(toggleClick).toHaveBeenCalled();
    });

    it('should clear all regions when requested', () => {
        const mockSetRegions = vi.fn();
        const mockSetSelectedRegionId = vi.fn();
        
        renderPluginSlot(initRegionToolbarPlugin, 'fitsimage:toolbar:left', {
            regions: [{ id: '1', type: 'circle' }], // Mock that we have a region
            setRegions: mockSetRegions,
            setSelectedRegionId: mockSetSelectedRegionId
        });

        fireEvent.click(screen.getByText(/Clear All Regions/i));
        
        expect(mockSetRegions).toHaveBeenCalledWith([]);
        expect(mockSetSelectedRegionId).toHaveBeenCalledWith(null);
    });
});