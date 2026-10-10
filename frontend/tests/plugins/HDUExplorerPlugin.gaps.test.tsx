import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initHDUExplorerPlugin } from '../../src/plugins/HDUExplorerPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const hduList = [
    { index: 1, extname: 'PRIMARY', type: 'image', naxes: [10, 20] },
    { index: 2, extname: 'SCI', type: 'image', naxes: [], compression: 'RICE_1' },
    { index: 3, extname: 'EMPTYHDU', type: 'empty' },
    { index: 4, extname: 'TAB', type: 'table' },
];

describe('HDUExplorerPlugin gaps', () => {
    afterEach(() => cleanup());

    it('mobile menu renders nothing for an empty list', () => {
        renderPluginSlot(initHDUExplorerPlugin, 'menubar:mobile', { hduList: [] });
        expect(screen.queryByText('HDUs')).toBeNull();
    });

    it('mobile menu lists HDUs with dims and selects one, closing the menubar', () => {
        const setActiveHdu = vi.fn();
        const bar = document.createElement('div');
        bar.id = 'topMenubar'; bar.className = 'show';
        document.body.appendChild(bar);
        renderPluginSlot(initHDUExplorerPlugin, 'menubar:mobile', { hduList, activeHdu: 1, setActiveHdu });
        expect(screen.getByText('(10x20)')).toBeInTheDocument();
        fireEvent.click(screen.getByText('TAB'));
        expect(setActiveHdu).toHaveBeenCalledWith(4);
        expect(bar.classList.contains('show')).toBe(false);
        // works when menubar element is absent
        bar.remove();
        fireEvent.click(screen.getByText('EMPTYHDU'));
        expect(setActiveHdu).toHaveBeenCalledWith(3);
    });

    it('sidebar shows empty message, dims, compression marker and toggle closed state', () => {
        renderPluginSlot(initHDUExplorerPlugin, 'workspace:left', { hduList: [] });
        expect(screen.getByText('No file loaded')).toBeInTheDocument();
        cleanup();
        const { container } = renderPluginSlot(initHDUExplorerPlugin, 'workspace:left', { hduList, activeHdu: 2, isSidebarOpen: false });
        expect(screen.getByText('(10x20)')).toBeInTheDocument();
        expect(screen.getByText('IMAGE*')).toHaveAttribute('title', 'Tile compressed (RICE_1)');
        expect(container.querySelector('.active')).toHaveTextContent('SCI');
        expect((container.firstElementChild as HTMLElement).style.width).toBe('0px');
    });

    it('toggle button opens a closed sidebar', () => {
        const setIsSidebarOpen = vi.fn();
        renderPluginSlot(initHDUExplorerPlugin, 'menubar:left', { isSidebarOpen: false, setIsSidebarOpen });
        fireEvent.click(screen.getByTitle(/Toggle HDU Sidebar/i));
        expect(setIsSidebarOpen).toHaveBeenCalledWith(true);
    });
});
