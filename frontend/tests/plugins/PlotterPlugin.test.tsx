import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initPlotterPlugin } from '../../src/plugins/PlotterPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('PlotterPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render the toggle button in the menubar', () => {
        renderPluginSlot(initPlotterPlugin, 'menubar:right');
        const btn = screen.getByTitle(/Toggle Plotter Sidebar/i);
        expect(btn).toBeInTheDocument();
    });

    it('should toggle the plotter open/closed', () => {
        const mockSetIsPlotterOpen = vi.fn();
        renderPluginSlot(initPlotterPlugin, 'menubar:right', {
            isPlotterOpen: false,
            setIsPlotterOpen: mockSetIsPlotterOpen
        });

        fireEvent.click(screen.getByTitle(/Toggle Plotter Sidebar/i));
        expect(mockSetIsPlotterOpen).toHaveBeenCalledWith(true);
    });

    it('should render the plotter sidebar UI when open', () => {
        // We test the 'workspace:right' slot this time!
        renderPluginSlot(initPlotterPlugin, 'workspace:right', {
            isPlotterOpen: true,
            // Mock an active table so the scatter plot UI shows up
            tableInfo: { numCols: 2, columns: [{ name: 'TIME' }, { name: 'RATE' }] },
            activeHdu: 2
        });

        // Verify the title of the panel exists
        expect(screen.getByText(/Analysis Plotter/i)).toBeInTheDocument();
        
        // Verify the plot type selector exists
        expect(screen.getByDisplayValue(/Scatter Plot/i)).toBeInTheDocument();
    });
});