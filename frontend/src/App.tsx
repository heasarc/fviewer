// # Copyright 2026, University of Maryland, All Rights Reserved
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCore } from './core/FViewerContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useCommandHandler } from './hooks/useCommandHandler';
import { useCoreCommands } from './hooks/useCoreCommands';
import { ExtensionSlot } from './core/PluginManager';
import { VirtualTable } from './components/VirtualTable';
import { VectorModal } from './components/VectorModal';
import { FitsImage } from './components/FitsImage';
import fviewerLogo from '/fviewer-logo.svg';
import { FITS_FORMATS } from './utils/constants';

function App() {

    // Get everything we need from the Core Context
    const { 
        fitsWorker, voWorker, activeDataType,
        fileName, hduList, 
        activeHdu, tableInfo, setTableInfo, 
        imageData, setImageData, isLoading, setIsLoading,
        isPlotterOpen, processFile, regions, setRegions, setIsConnected,
        setCurrentSlice, selectedCatalogRow, setSelectedCatalogRow
    } = useCore();

    // Deconstruct the worker methods we need for this file
    const { moveToHDU, getTableInfo, writeCell, saveFile, readImage } = fitsWorker;
    
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Data State
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const isPlotterOpenRef = useRef(isPlotterOpen);

    // State for the Vector Modal
    const [selectedVector, setSelectedVector] = useState<{
        colName: string;
        rowIndex: number;
        data: any;
    } | null>(null);

    // State for the Bottom Drawer (Table) visibility and height
    const [isTableDrawerOpen, setIsTableDrawerOpen] = useState(true);
    const [tableHeight, setTableHeight] = useState(300); // Default 300px height
    const isDraggingRef = useRef(false);

    // Native Drag-to-Resize Handlers
    const startDrag = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        document.body.style.cursor = 'row-resize'; // Change cursor for whole body while dragging
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
    }, []);

    const onDrag = useCallback((e: MouseEvent) => {
        if (!isDraggingRef.current) return;
        // e.movementY is negative when dragging up, positive when down.
        // Since the table is at the bottom, dragging UP increases its height.
        setTableHeight((prevHeight) => {
            const newHeight = prevHeight - e.movementY;
            // Constrain between 100px (min) and window height - 150px (max)
            return Math.max(100, Math.min(newHeight, window.innerHeight - 150));
        });
    }, []);

    const stopDrag = useCallback(() => {
        isDraggingRef.current = false;
        document.body.style.cursor = ''; // Reset cursor
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
    }, [onDrag]);

    const handleClearCatalog = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent the click from toggling the drawer collapse
        
        // 1. Clear table data and metadata
        setTableInfo(null);
        setTableData({});
        setSelectedCatalogRow(null);
        
        // 2. Remove catalog regions from the image overlay
        // NOTE: You might need to adjust this filter depending on how your Region 
        // interface is defined. I am assuming catalog regions have a specific property 
        // like `isCatalog` or `type === 'catalog'`.
        setRegions((prevRegions: any[]) => 
            prevRegions.filter(region => !region.isCatalog) // Adjust this condition if needed!
        );
        
        // Optional: If activeDataType was strictly 'votable', you might want to 
        // switch it back to 'fits' or handle that context shift if necessary.
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        await processFile(file);
        
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Handle API commands
    // 1. Initialize the generic WebSocket command listener
    const handleRemoteCommand = useCommandHandler();
    
    // 2. Register the Core Commands (passing the state they need)
    useCoreCommands(
        processFile,
        regions, setRegions,
        imageData, 
        fitsWorker.pixToWorld, 
        fitsWorker.worldToPix
    );
    // Listen for commands
    const { clientId, isConnected } = useWebSocket(handleRemoteCommand);

    // Sync it to context so the plugin knows!
    useEffect(() => {
        setIsConnected(isConnected);
    }, [isConnected, setIsConnected]);

    // keep the plot panel refs in sync
    useEffect(() => {
        isPlotterOpenRef.current = isPlotterOpen;
    }, [isPlotterOpen]);

    useEffect(() => {
        // If we are looking at a VOTable, the worker already extracted the tableInfo!
        if (activeDataType === 'votable') return;
        if (!activeHdu) return;

        const loadHduData = async () => {
            setIsLoading(true);
            try {
                const targetHdu = hduList.find(h => h.index === activeHdu);
                await moveToHDU(activeHdu);

                setImageData(null);
                setTableInfo(null);
                setTableData({});

                if (targetHdu?.type === 'image') {
                    // --- Handle Slicing ---
                    // If it's a cube (e.g. naxes = [1024, 1024, 50]), create [1]
                    // If 4D (e.g. [1024, 1024, 50, 4]), create [1, 1]
                    const defaultSlice = targetHdu.naxes && targetHdu.naxes.length > 2 
                        ? Array(targetHdu.naxes.length - 2).fill(1) 
                        : [];
                    
                    setCurrentSlice(defaultSlice);

                    // Pass the slice to the worker!
                    const img = await readImage(defaultSlice);
                    setImageData(img);
                } 
                else if (targetHdu?.type === 'table') {
                    const info = await getTableInfo();
                    setTableInfo(info);
                    
                    // DO NOT fetch all columns here anymore!
                    // Just set empty arrays or let VirtualTable trigger the fetch
                    setTableData({}); 

                }
            } catch (error) {
                console.error("Failed to load HDU data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadHduData();
    }, [activeHdu, fileName, activeDataType]);

    const handleCellEdit = async (colName: string, colNum: number, rowIndex: number, newValue: string) => {
        // Silently ignore edits working with votables
        if (activeDataType === 'votable') return; 

        try {
            const numericValue = Number(newValue);
            if (isNaN(numericValue)) return alert("Only numeric edits are supported.");
            await writeCell(colNum, rowIndex + 1, numericValue);
            setTableData(prevData => {
                const newData = { ...prevData };
                const newCol = [...newData[colName]];
                newCol[rowIndex] = numericValue;
                newData[colName] = newCol;
                return newData;
            });
        } catch (error) {
            console.error("Failed to write cell:", error);
        }
    };

    const handleVectorEdit = async (arrayIndex: number, newValue: string) => {
        // Silently ignore edits working with votables
        if (activeDataType === 'votable') return; 

        if (!selectedVector || !tableInfo) return;
        try {
            const numericValue = Number(newValue);
            if (isNaN(numericValue)) return alert("Only numeric edits are supported.");
            
            // Find the 1-indexed column number
            const colNum = tableInfo.columns.findIndex((c: any) => c.name === selectedVector.colName) + 1;
            
            // Call the worker with the 4th argument (arrayIndex)
            await writeCell(colNum, selectedVector.rowIndex + 1, numericValue, arrayIndex);
            
            // Note: The VectorModal already optimistically updates its local TypedArray view, 
            // so we don't need to manually update tableData here to see the change!
        } catch (error) {
            console.error("Failed to write vector element:", error);
            alert("Failed to save edit.");
        }
    };

    const handleSave = async () => {
        try {
            setIsLoading(true);
            const fileBytes = await saveFile();
            const blob = new Blob([fileBytes], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `edited_${fileName}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to save:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Handle reading part of table data
    const handleFetchTableData = useCallback(async (startRow: number, endRow: number) => {
        if (!tableInfo) return;
        
        try {
            // Ask the worker for just this slice of data
            // Expecting the worker to return an object like: { COL1: Float32Array, COL2: Int32Array }
            // Route to the correct worker!
            const worker = activeDataType === 'fits' ? fitsWorker : voWorker;
            const chunk = await worker.readTableChunk(startRow, endRow);
            
            setTableData(prevData => {
                const newData = { ...prevData };
                
                // Initialize arrays if they don't exist
                tableInfo.columns.forEach((col: any) => {
                    if (!newData[col.name]) {
                        newData[col.name] = new Array(tableInfo.numRows);
                    }
                    
                    // Merge the new chunk into the existing column array
                    const columnChunk = chunk[col.name];
                    if (columnChunk) {
                        for (let i = 0; i < columnChunk.length; i++) {
                            newData[col.name][startRow + i] = columnChunk[i];
                        }
                    }
                });
                return newData;
            });
        } catch (err) {
            console.error("Failed to fetch table chunk:", err);
        }
    }, [tableInfo, activeDataType, fitsWorker, voWorker]);

    // Jump-start the table data fetch when a new table is loaded
    useEffect(() => {
        // If we have table info, but tableData is completely empty, fetch the first 100 rows!
        if (tableInfo && tableInfo.numRows > 0 && Object.keys(tableData).length === 0) {
            const initialFetchSize = Math.min(100, tableInfo.numRows);
            handleFetchTableData(0, initialFetchSize);
        }
    }, [tableInfo, tableData, handleFetchTableData]);

    return (
        // 1. App Layout: Full height, flex column, hide overflow
        <div className="vh-100 d-flex flex-column overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text)' }}>
            
            {/* Hidden File Input */}
            <input type="file" ref={fileInputRef} accept={FITS_FORMATS} style={{ display: 'none' }} onChange={handleFileUpload} />

            {/* 2. Top Menubar */}
            <nav className="navbar navbar-expand-md navbar-dark flex-shrink-0 border-bottom px-3 py-0" style={{ minHeight: '36px', backgroundColor: '#13151f', borderColor: 'var(--fv-border)' }}>
                <div className="container-fluid p-0">
                    
                    {/* Logo */}
                    <span className="navbar-brand fw-bold d-flex align-items-center gap-2 m-0 p-0" style={{ color: 'var(--fv-accent)', letterSpacing: '1px', fontSize: '1rem' }}>
                        <img 
                            src={fviewerLogo}
                            alt="FViewer Logo" 
                            width="24" 
                            height="24" 
                            style={{ 
                                borderRadius: '8px', 
                                border: '1px solid var(--fv-accent)',
                            }} 
                        /> 
                        FViewer
                    </span>

                    {/* Hamburger Button (Visible only on mobile) */}
                    <button className="navbar-toggler border-0 px-1 py-0" type="button" data-bs-toggle="collapse" data-bs-target="#topMenubar" aria-controls="topMenubar" aria-expanded="false" aria-label="Toggle navigation">
                        <span className="navbar-toggler-icon" style={{ width: '1.2em', height: '1.2em' }}></span>
                    </button>

                    {/* Left-aligned Toggles & Menus */}
                    <div className="collapse navbar-collapse" id="topMenubar">
                        <ul className="navbar-nav me-auto mb-2 mb-md-0 d-flex align-items-md-center">
                            
                            {/* PLUGINS: Left Sidebar Toggle Button */}
                            <ExtensionSlot name="menubar:left" />

                            {/* File Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">File</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => fileInputRef.current?.click()}><i className="bi bi-folder2-open"></i> Open Local File...</button></li>
                                    <ExtensionSlot name="menubar:file" />
                                    <li><hr className="dropdown-divider border-secondary my-1" /></li>
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={handleSave} disabled={hduList.length === 0 || isLoading}><i className="bi bi-save"></i> Save Edited FITS</button></li>
                                </ul>
                            </li>

                            {/* Edit Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">Edit</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-layout-three-columns"></i> Manage Columns</button></li>
                                    <ExtensionSlot name="menubar:edit" />
                                </ul>
                            </li>

                            {/* View Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">View</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-aspect-ratio"></i> Reset View</button></li>
                                    <ExtensionSlot name="menubar:view" />
                                </ul>
                            </li>

                            {/* PLUGINS CAN ADD NEW MENUS HERE */}
                            <ExtensionSlot name="menubar:menus" />

                            {/* About Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">About</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><span className="dropdown-item fv-dropdown-item">FViewer Version: 0.3.8</span></li>
                                </ul>
                            </li>

                            {/* PLUGINS: Mobile HDU Menu */}
                            <ExtensionSlot name="menubar:mobile" />
                        </ul>

                        {/* Right-aligned Status / Filename & Toggles */}
                        <div className="d-flex align-items-center gap-3 ms-3 ms-md-0 pb-2 pb-md-0">
                            {/* API Connection Status */}
                            <div 
                                className="d-none d-md-flex align-items-center" 
                                title={`API Client ID: ${clientId?.split('-')[0]} (${isConnected ? 'Connected' : 'Disconnected'})`}
                            >
                                <i className={`bi ${isConnected ? 'bi-plug-fill fv-text-primary' : 'bi-plug fv-text-muted'}`} style={{ fontSize: '1rem' }}></i>
                            </div>

                            <span className="text-truncate d-none d-sm-block fv-text-muted" style={{ fontSize: '0.8rem', maxWidth: '200px' }}>
                                {fileName}
                            </span>
                            
                            {isLoading && <div className="spinner-border spinner-border-sm fv-text-primary" role="status"></div>}
                            
                            {/* Plotter Toggle Button */}
                            <ExtensionSlot name="menubar:right" />
                        </div>
                    </div>
                </div>
            </nav>

            {/* 3. Application Body (Sidebar + Workspace) */}
            <div className="d-flex flex-row flex-grow-1 overflow-hidden">
                
                {/* Collapsible Left Sidebar: HDU List */}
                <ExtensionSlot name="workspace:left" />

                {/* Main Content + Right Plotter Sidebar */}
                <div className="d-flex flex-row flex-grow-1 overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)' }}>
                    
                    {/* Center: Image or Table Viewer */}
                    <div className="flex-grow-1 overflow-hidden p-3 d-flex flex-column">
                        {(activeHdu !== null || activeDataType === 'votable') && (
                            <div className="fade-in d-flex flex-column flex-grow-1 gap-3 overflow-hidden">
                                
                                {hduList.find(h => h.index === activeHdu)?.type === 'empty' && (
                                    <div className="alert border bg-dark text-white d-flex align-items-center" style={{ borderColor: 'var(--fv-border)' }}>
                                        <i className="bi bi-info-circle me-2"></i> This HDU contains no data (NAXIS=0).
                                    </div>
                                )}

                                {/* Center Workspace: flex-column for Bottom Drawer layout */}
                                <div className="d-flex flex-column flex-grow-1 gap-2 overflow-hidden">
                                    
                                    {/* Image Viewer (Top) */}
                                    {imageData && imageData.width > 0 && (
                                        <div className="d-flex flex-column shadow-sm" style={{ flex: 1, minHeight: 0 }}>
                                            <div className="fv-panel-box d-flex flex-column w-100 h-100 border-0">
                                                <div className="fv-panel-header">
                                                    <span><i className="bi bi-image me-2"></i> Image Display</span>
                                                </div>
                                                <div className="flex-grow-1 position-relative d-flex flex-column" style={{ minHeight: 0 }}>
                                                    <FitsImage 
                                                        data={imageData.data} width={imageData.width} height={imageData.height} 
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* DRAGGABLE RESIZER */}
                                    {imageData && tableInfo && isTableDrawerOpen && (
                                        <div 
                                            onMouseDown={startDrag}
                                            className="w-100 rounded"
                                            style={{ 
                                                height: '6px', 
                                                cursor: 'row-resize', 
                                                backgroundColor: 'var(--fv-border)',
                                                opacity: 0.8,
                                                transition: 'opacity 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                                        />
                                    )}

                                    {/* Table Viewer (Bottom Drawer) */}
                                    {tableInfo && (
                                        <div 
                                            className="fv-panel-box d-flex flex-column shadow-sm border-0" 
                                            style={{ 
                                                // CONDITIONAL LAYOUT:
                                                // If there is an image above, stick to the fixed dragged height.
                                                // If there is no image, grow to fill the entire workspace (flex: 1).
                                                flex: (imageData && imageData.width > 0) ? 'none' : '1', 
                                                height: isTableDrawerOpen 
                                                    ? ((imageData && imageData.width > 0) ? `${tableHeight}px` : '100%') 
                                                    : 'auto',
                                                minHeight: isTableDrawerOpen 
                                                    ? ((imageData && imageData.width > 0) ? `${tableHeight}px` : '0') 
                                                    : 'auto',
                                            }}
                                        >
                                            <div 
                                                className="fv-panel-header d-flex justify-content-between align-items-center"
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => setIsTableDrawerOpen(!isTableDrawerOpen)}
                                                title={isTableDrawerOpen ? "Collapse Table" : "Expand Table"}
                                            >
                                                <div>
                                                    <i className={`bi ${isTableDrawerOpen ? 'bi-chevron-down' : 'bi-chevron-right'} me-2`}></i>
                                                    <span><i className="bi bi-table me-2"></i>Table</span>
                                                    <span className="badge bg-secondary ms-2">{tableInfo.numRows} Rows | {tableInfo.numCols} Cols</span>
                                                </div>
                                                
                                                {/* Clear Catalog Button; show only if displayed along with image data */}
                                                {(imageData && imageData.width > 0) &&
                                                <button 
                                                    className="btn btn-sm btn-link text-white p-0 m-0 border-0" 
                                                    onClick={handleClearCatalog}
                                                    title="Close Table and Clear Overlays"
                                                    style={{ opacity: 0.7 }}
                                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                                                >
                                                    <i className="bi bi-x-lg"></i>
                                                </button>
                                                }
                                            </div>
                                            
                                            {/* Only render the table body if the drawer is open */}
                                            {isTableDrawerOpen && (
                                                <div className="flex-grow-1 overflow-hidden position-relative">
                                                    <VirtualTable 
                                                        numRows={tableInfo.numRows} 
                                                        columns={tableInfo.columns} 
                                                        dataMap={tableData} 
                                                        onCellEdit={handleCellEdit} 
                                                        onFetchData={handleFetchTableData}
                                                        onVectorClick={(colName, rowIndex, data) => setSelectedVector({ colName, rowIndex, data })}
                                                        isReadOnly={activeDataType === 'votable'}
                                                        selectedRow={selectedCatalogRow}
                                                        onRowClick={(idx) => setSelectedCatalogRow(idx)}
                                                    />
                                                </div>
                                            )}
                                            
                                            {/* Render the Modal if a vector is selected */}
                                            {selectedVector && isTableDrawerOpen && (
                                                <VectorModal
                                                    colName={selectedVector.colName}
                                                    rowIndex={selectedVector.rowIndex}
                                                    data={selectedVector.data}
                                                    onClose={() => setSelectedVector(null)}
                                                    onEditElement={handleVectorEdit}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                            </div>
                        )}
                    </div>

                    {/* Extension slot for the right workspace */}
                    <ExtensionSlot name="workspace:right" />

                </div>
            </div>
        </div>
    );
}

export default App;