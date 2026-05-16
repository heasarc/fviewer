// # Copyright 2026, University of Maryland, All Rights Reserved
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCore } from './core/FViewerContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useCommandHandler } from './hooks/useCommandHandler';
import { useCoreCommands } from './hooks/useCoreCommands';
import { ExtensionSlot } from './core/PluginManager';
import { VirtualTable } from './components/VirtualTable';
import { FitsImage } from './components/FitsImage';
import fviewerLogo from '/fviewer-logo.svg';
import { FITS_FORMATS } from './utils/constants';

function App() {

    // Get everything we need from the Core Context
    const { 
        fitsWorker, fileName, hduList, 
        activeHdu, setActiveHdu, tableInfo, setTableInfo, 
        imageData, setImageData, isLoading, setIsLoading,
        isPlotterOpen, processFile, regions, setRegions, setIsConnected
    } = useCore();

    // Deconstruct the worker methods we need for this file
    const { moveToHDU, getTableInfo, writeCell, saveFile, readImage, readTableChunk } = fitsWorker;
    
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Data State
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const isPlotterOpenRef = useRef(isPlotterOpen);

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
                    const img = await readImage();
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
    }, [activeHdu, fileName]);

    const handleCellEdit = async (colName: string, colNum: number, rowIndex: number, newValue: string) => {
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
            const chunk = await readTableChunk(startRow, endRow);
            
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
    }, [tableInfo, readTableChunk]);

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
                            
                            {/* Left Sidebar Toggle Button */}
                            <li className="nav-item">
                                <button 
                                    className={`btn menubar-btn px-3 h-100 ${isSidebarOpen ? 'fv-text-primary' : 'fv-text-muted'}`}
                                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                    title="Toggle HDU Sidebar"
                                >
                                    <i className="bi bi-layout-sidebar"></i>
                                </button>
                            </li>

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
                                </ul>
                            </li>

                            {/* PLUGINS CAN ADD NEW MENUS HERE */}
                            <ExtensionSlot name="menubar:menus" />

                            {/* About Menu */}
                            <li className="nav-item dropdown">
                                <button className="btn menubar-btn text-start w-100 px-3 py-2 py-md-0" style={{ fontSize: '0.85rem', height: '36px' }} data-bs-toggle="dropdown">About</button>
                                <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute">
                                    <li><span className="dropdown-item fv-dropdown-item">FViewer Version: 0.3.0</span></li>
                                </ul>
                            </li>

                            {/* Mobile HDU Menu (Only visible on small screens when Sidebar is hidden) */}
                            {hduList.length > 0 && (
                                <li className="nav-item dropdown d-md-none">
                                    <button className="btn menubar-btn text-start w-100 px-3 py-2 text-info fw-bold" style={{ fontSize: '0.85rem' }} data-bs-toggle="dropdown">
                                        <i className="bi bi-layers"></i> HDUs
                                    </button>
                                    <ul className="dropdown-menu fv-dropdown-menu shadow position-absolute overflow-auto w-100" style={{ maxHeight: '50vh' }}>
                                        {hduList.map((hdu) => (
                                            <li key={hdu.index}>
                                                <button 
                                                    className={`dropdown-item fv-dropdown-item d-flex justify-content-between align-items-center ${activeHdu === hdu.index ? 'fw-bold text-info' : ''} ${hdu.type === 'empty' ? 'text-muted' : ''}`}
                                                    onClick={() => { setActiveHdu(hdu.index); document.getElementById('topMenubar')?.classList.remove('show'); /* Auto-close menu on mobile click */ }}
                                                >
                                                    <span className="text-truncate" style={{ maxWidth: '150px' }}>{hdu.extname}</span>
                                                    <span className="badge border border-secondary text-secondary bg-dark ms-2" style={{ fontSize: '0.6rem' }}>{hdu.type.toUpperCase()}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            )}
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
                <div 
                    className="d-none d-md-flex flex-column flex-shrink-0 border-end z-1 shadow-sm" 
                    style={{ 
                        width: isSidebarOpen ? '240px' : '0px', 
                        backgroundColor: 'var(--fv-panel)', 
                        borderColor: 'var(--fv-border)',
                        transition: 'width 0.3s ease-in-out',
                        overflow: 'hidden' // Hides contents when width is 0
                    }}
                >
                    {/* Inner container fixed at 240px to prevent text crushing during slide animation */}
                    <div style={{ width: '240px', minWidth: '240px' }} className="d-flex flex-column h-100 overflow-auto">
                        <div className="p-2 fw-bold text-uppercase border-bottom d-flex align-items-center" style={{ fontSize: '0.75rem', color: 'var(--fv-text-bright)', backgroundColor: 'var(--fv-bg)', borderColor: 'var(--fv-border)', letterSpacing: '0.5px' }}>
                            <i className="bi bi-layers me-2"></i> HDU Explorer
                        </div>
                        
                        {hduList.length === 0 ? (
                            <div className="p-3 fv-text-muted fst-italic" style={{ fontSize: '0.8rem' }}>No file loaded</div>
                        ) : (
                            hduList.map((hdu) => (
                                <button 
                                    key={hdu.index}
                                    className={`w-100 text-start px-3 py-2 d-flex justify-content-between align-items-center border-0 fv-sidebar-item ${activeHdu === hdu.index ? 'active' : ''}`}
                                    onClick={() => setActiveHdu(hdu.index)}
                                >
                                    <span className="text-truncate" style={{ maxWidth: '140px', fontSize: '0.85rem' }} title={hdu.extname}>
                                        {hdu.extname}
                                    </span>
                                    <span className="badge border border-secondary text-secondary bg-dark" style={{ fontSize: '0.65rem', fontWeight: 'normal' }}>
                                        {hdu.type.toUpperCase()}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                    {/* Sidebar Extension slot for plugins */}
                    <ExtensionSlot name="sidebar:right" />
                </div>

                {/* Main Content + Right Plotter Sidebar */}
                <div className="d-flex flex-row flex-grow-1 overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)' }}>
                    
                    {/* Center: Image or Table Viewer */}
                    <div className="flex-grow-1 overflow-auto p-3 d-flex flex-column">
                        {activeHdu && (
                            <div className="fade-in d-flex flex-column flex-grow-1 gap-3">
                                
                                {hduList.find(h => h.index === activeHdu)?.type === 'empty' && (
                                    <div className="alert border bg-dark text-white d-flex align-items-center" style={{ borderColor: 'var(--fv-border)' }}>
                                        <i className="bi bi-info-circle me-2"></i> This HDU contains no data (NAXIS=0).
                                    </div>
                                )}

                                {/* Image Viewer */}
                                {imageData && imageData.width > 0 && (
                                    <div className="d-flex justify-content-center w-100 mb-3">
                                        <div 
                                            className="fv-panel-box d-flex flex-column w-100 shadow-sm" 
                                            // Added maxHeight: '70vh' so it shrinks vertically on small screens!
                                            style={{ maxWidth: '800px', height: '650px', maxHeight: '90vh' }} 
                                        >
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

                                {/* Table Viewer */}
                                {tableInfo && (
                                    <div className="fv-panel-box d-flex flex-column flex-grow-1 shadow-sm">
                                        <div className="fv-panel-header">
                                            <span><i className="bi bi-table me-2"></i> Binary Table</span>
                                            <span className="badge bg-secondary">{tableInfo.numRows} Rows | {tableInfo.numCols} Cols</span>
                                        </div>
                                        <div className="flex-grow-1 overflow-hidden" style={{ minHeight: '400px' }}>
                                            <VirtualTable 
                                                numRows={tableInfo.numRows} 
                                                columns={tableInfo.columns} 
                                                dataMap={tableData} 
                                                onCellEdit={handleCellEdit} 
                                                onFetchData={handleFetchTableData}
                                            />
                                        </div>
                                    </div>
                                )}
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