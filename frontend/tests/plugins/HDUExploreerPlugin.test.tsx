import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initHDUExplorerPlugin } from '../../src/plugins/HDUExplorerPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('HDUExplorerPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render the toggle button in the menubar', () => {
        renderPluginSlot(initHDUExplorerPlugin, 'menubar:left');
        const btn = screen.getByTitle(/Toggle HDU Sidebar/i);
        expect(btn).toBeInTheDocument();
    });

    it('should toggle sidebar state when button is clicked', () => {
        const mockSetIsSidebarOpen = vi.fn();
        renderPluginSlot(initHDUExplorerPlugin, 'menubar:left', {
            isSidebarOpen: true,
            setIsSidebarOpen: mockSetIsSidebarOpen
        });

        fireEvent.click(screen.getByTitle(/Toggle HDU Sidebar/i));
        expect(mockSetIsSidebarOpen).toHaveBeenCalledWith(false);
    });

    it('should render the HDU list in the workspace sidebar', () => {
        const mockHduList = [
            { index: 1, extname: 'PRIMARY', type: 'image' },
            { index: 2, extname: 'EVENTS', type: 'table' }
        ];

        renderPluginSlot(initHDUExplorerPlugin, 'workspace:left', {
            hduList: mockHduList,
            activeHdu: 1
        });

        expect(screen.getByText('PRIMARY')).toBeInTheDocument();
        expect(screen.getByText('EVENTS')).toBeInTheDocument();
    });

    it('should call setActiveHdu when an HDU is clicked', () => {
        const mockSetActiveHdu = vi.fn();
        const mockHduList = [
            { index: 1, extname: 'PRIMARY', type: 'image' },
            { index: 2, extname: 'EVENTS', type: 'table' }
        ];

        renderPluginSlot(initHDUExplorerPlugin, 'workspace:left', {
            hduList: mockHduList,
            activeHdu: 1,
            setActiveHdu: mockSetActiveHdu
        });

        // Click the EVENTS HDU
        fireEvent.click(screen.getByText('EVENTS'));
        expect(mockSetActiveHdu).toHaveBeenCalledWith(2);
    });
});