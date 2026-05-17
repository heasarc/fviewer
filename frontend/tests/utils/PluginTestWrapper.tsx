// tests/utils/pluginTestWrapper.tsx
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { FViewerContext } from '../../src/core/FViewerContext';
import { commandRegistry } from '../../src/core/CommandRegistry';
import { ExtensionSlot } from '../../src/core/PluginManager';
import { pluginManager } from '../../src/core/PluginManager'; 


/**
 * Creates a mock FViewerContext fulfilling the exact CoreContextType interface.
 */
export const createMockContext = (overrides = {}) => {
    return {
        // Dummy Worker (Mocking all potential useFits returns)
        fitsWorker: {
            openFile: vi.fn(), getHduList: vi.fn(), moveToHDU: vi.fn(),
            getTableInfo: vi.fn(), readColumn: vi.fn(), writeCell: vi.fn(), saveFile: vi.fn(),
            readImage: vi.fn(), readHeader: vi.fn(), updateKeyword: vi.fn(), readTableChunk: vi.fn(),
            checkWcs: vi.fn().mockResolvedValue(true), 
            pixToWorld: vi.fn(), worldToPix: vi.fn(),
        } as any,
        
        // App State
        fileName: 'data/test_im.fits', setFileName: vi.fn(),
        hduList: [], setHduList: vi.fn(),
        activeHdu: null, setActiveHdu: vi.fn(),
        tableInfo: null, setTableInfo: vi.fn(),
        imageData: null, setImageData: vi.fn(),
        isLoading: false, setIsLoading: vi.fn(),
        
        // Plotting
        isPlotterOpen: false, setIsPlotterOpen: vi.fn(),
        activeRegionPixels: null, setActiveRegionPixels: vi.fn(),
        
        // Server & File
        regions: [], setRegions: vi.fn(),
        processFile: vi.fn(),
        isConnected: true, setIsConnected: vi.fn(),
        serverModalMode: null as null | 'fits' | 'region', setServerModalMode: vi.fn(),
        
        // Image Control
        colormap: 'gray', setColormap: vi.fn(),
        stretch: 'linear', setStretch: vi.fn(),
        zoom: 1, setZoom: vi.fn(),
        pan: {x:0, y:0}, setPan: vi.fn(),
        flipX: false, setFlipX: vi.fn(),
        flipY: false, setFlipY: vi.fn(),
        rotation: 0, setRotation: vi.fn(),
        
        // Region Control
        drawMode: 'pan' as any, setDrawMode: vi.fn(),
        draftRegion: null, setDraftRegion: vi.fn(),
        selectedRegionId: null, setSelectedRegionId: vi.fn(),
        hoveredRegionId: null, setHoveredRegionId: vi.fn(),
        dragAction: null, setDragAction: vi.fn(),
        deleteSelectedRegion: vi.fn(), handleRegionDrag: vi.fn(),
        
        // Sidebar
        isSidebarOpen: true, setIsSidebarOpen: vi.fn(),
        
        ...overrides,
    };
};

/**
 * Renders a specific Plugin Slot wrapped in a mock Context.
 */
export const renderPluginSlot = (
    initPluginFn: () => void, 
    slotName: string, 
    mockContextOverrides = {}
) => {

    // 1. Clear registries to prevent test pollution
    commandRegistry['handlers'].clear(); 
    
    // clear previous slots
    pluginManager['slots'].clear(); 
    
    // 2. Initialize the plugin (registers commands and UI)
    initPluginFn();
    
    // 3. Create context
    const contextValue = createMockContext(mockContextOverrides);

    // 4. Render the specific Extension Slot
    const rendered = render(
        <FViewerContext.Provider value={contextValue}>
            <ExtensionSlot name={slotName} />
        </FViewerContext.Provider>
    );

    return { 
        ...rendered, 
        contextValue, 
        executeCommand: (cmd: any) => commandRegistry.execute(cmd, vi.fn()) 
    };
};