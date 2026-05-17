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