// # Copyright 2026, University of Maryland, All Rights Reserved
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCore } from './core/FViewerContext';
import { useWebSocket, getApiUrl } from './hooks/useWebSocket';
import { useCommandHandler } from './hooks/useCommandHandler';
import { useCoreCommands } from './hooks/useCoreCommands';
import { ExtensionSlot } from './core/PluginManager';
import { VirtualTable } from './components/VirtualTable';
import { FitsImage } from './components/FitsImage';
import type { Region } from './utils/regionUtils';
import { parseDS9Regions, serializeDS9Regions } from './utils/regionUtils';
import { ServerFileModal } from './components/ServerFileModal';
import fviewerLogo from '/fviewer-logo.svg';
import { FITS_FORMATS, ALLOWED_EXTS } from './utils/constants';

function App() {

    // Get everything we need from the Core Context
    const { 
        fitsWorker, fileName, setFileName, hduList, setHduList, 
        activeHdu, setActiveHdu, tableInfo, setTableInfo, 
        imageData, setImageData, isLoading, setIsLoading,
        setActiveRegionPixels, isPlotterOpen
    } = useCore();

    // Deconstruct the worker methods we need for this file
    const { openFile, moveToHDU, getTableInfo, writeCell, saveFile, readImage, getHduList, 
          checkWcs, pixToWorld, worldToPix, readTableChunk } = fitsWorker;
    
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Data State
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const isPlotterOpenRef = useRef(isPlotterOpen);
    
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('linear');

    const [serverModalMode, setServerModalMode] = useState<'fits' | 'region' | null>(null);

    const [regions, setRegions] = useState<Region[]>([]);
    const regionInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        await processFile(file);
        
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // handle the logic of opening a file, from upload or from the API
    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();
        const isValid = ALLOWED_EXTS.some(ext => fileName.endsWith(ext));
        if (!isValid) {
            alert(`Please select a valid FITS file. Allowed extensions: ${FITS_FORMATS}`);
            return;
        }

        setFileName(file.name);
        setIsLoading(true);
        
        try {
            let buffer: ArrayBuffer;
            
            // Intercept and decompress gzip files natively
            if (file.name.toLowerCase().endsWith('.gz')) {
                const ds = new DecompressionStream('gzip');
                const decompressedStream = file.stream().pipeThrough(ds);
                buffer = await new Response(decompressedStream).arrayBuffer();
            } else {
                buffer = await file.arrayBuffer();
            }
            
            await openFile(new Uint8Array(buffer));
            const list = await getHduList();
            setHduList(list);
            
            const firstValid = list.find((h: any) => h.type !== 'empty');
            setActiveHdu(firstValid ? firstValid.index : 1);
        } catch (error) {
            console.error("Failed to load file:", error);
            alert("Failed to load FITS file.");
        } finally {
            setIsLoading(false);
        }
    };

    // Handle API commands
    // 1. Initialize the generic WebSocket command listener
    const handleRemoteCommand = useCommandHandler();
    
    // 2. Register the Core Commands (passing the state they need)
    useCoreCommands(
        processFile,
        colormap, setColormap,
        stretch, setStretch,
        regions, setRegions,
        imageData, 
        fitsWorker.pixToWorld, 
        fitsWorker.worldToPix
    );
    // Listen for commands
    const { clientId, isConnected } = useWebSocket(handleRemoteCommand);

    // Server File listing
    const handleServerFileSelect = async (serverPath: string) => {
        try {
            setIsLoading(true);
            const response = await fetch(getApiUrl(`api/file?path=${encodeURIComponent(serverPath)}`));
            if (!response.ok) throw new Error("Failed to fetch file");
            
            // Route based on the mode
            if (serverModalMode === 'region' || serverPath.endsWith('.reg')) {
                if (!imageData) throw new Error("No image data available for region coordinate conversion.");
                const text = await response.text();
                const newRegions = await parseDS9Regions(
                    text, imageData.width, imageData.height, 
                    pixToWorld, worldToPix, imageData.pixScale || null
                );
                setRegions((prev: Region[]) => [...prev, ...newRegions]);
            } else {
                const blob = await response.blob();
                const filename = serverPath.split('/').pop() || 'remote.fits';
                const file = new File([blob], filename, { type: 'application/octet-stream' });
                await processFile(file);
            }
        } catch (error) {
            console.error("Error loading server file:", error);
            alert("Failed to load file from server.");
        } finally {
            setIsLoading(false);
            setServerModalMode(null); // Close the modal
        }
    };

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
    }, [activeHdu]);

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


    useEffect(() => {
        // If the user OPENS the plotter, and there is already an active image and region,
        // immediately calculate the pixel histogram!
        if (isPlotterOpen && imageData && regions.length > 0) {
            handleRegionChange(regions[regions.length - 1]);
        }
    }, [isPlotterOpen]);

    // --- EXTRACT REGION PIXELS FOR HISTOGRAM ---
    const handleRegionChange = useCallback((region: any | null) => {
        // 1. SHORT CIRCUIT: If no region, no image data, or the plotter is CLOSED, do absolutely nothing!
        if (!region || !imageData || !isPlotterOpenRef.current) {
            setActiveRegionPixels(null);
            return;
        }

        const { data, width, height } = imageData;
        const pixels: number[] = [];
        
        let cx = 0, cy = 0, w = 0, h = 0, radius = 0;
        
        if (region.type === 'box') {
            w = Math.abs(region.endX - region.startX);
            h = Math.abs(region.endY - region.startY);
            cx = (region.startX + region.endX) / 2;
            cy = (region.startY + region.endY) / 2;
        } else if (region.type === 'ellipse') {
            w = Math.abs(region.endX - region.startX) * 2;
            h = Math.abs(region.endY - region.startY) * 2;
            cx = region.startX;
            cy = region.startY;
        } else {
            radius = Math.hypot(region.endX - region.startX, region.endY - region.startY);
            w = radius * 2; h = radius * 2;
            cx = region.startX; cy = region.startY;
        }

        const rad = -(region.angle || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const maxR = Math.max(w/2, h/2); 
        const minX = Math.max(1, Math.floor(cx - maxR));
        const maxX = Math.min(width, Math.ceil(cx + maxR));
        const minY = Math.max(1, Math.floor(cy - maxR));
        const maxY = Math.min(height, Math.ceil(cy + maxR));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                
                const tx = x - cx; const ty = y - cy;
                const rx = tx * cos - ty * sin;
                const ry = tx * sin + ty * cos;

                let inside = false;
                if (region.type === 'box') {
                    if (Math.abs(rx) <= w/2 && Math.abs(ry) <= h/2) inside = true;
                } else if (region.type === 'ellipse') {
                    if ((rx*rx)/Math.pow(w/2, 2) + (ry*ry)/Math.pow(h/2, 2) <= 1) inside = true;
                } else if (region.type === 'annulus') {
                    const r2 = rx*rx + ry*ry;
                    const out2 = Math.pow(radius, 2);
                    const in2 = Math.pow(region.innerR || radius/2, 2);
                    if (r2 <= out2 && r2 >= in2) inside = true;
                } else { 
                    if (rx*rx + ry*ry <= Math.pow(radius, 2)) inside = true;
                }

                if (inside) {
                    const dataIdx = (height - y) * width + (x - 1);
                    pixels.push(data[dataIdx]);
                }
            }
        }
        
        setActiveRegionPixels(pixels);
    }, [imageData]);

    // --- REGION SERIALIZATION (.reg) ---
    const handleSaveRegions = async (format: 'image' | 'physical' | 'fk5' = 'fk5') => {
        if (regions.length === 0) return alert("No regions to save.");
        if (!imageData) return alert("No image data loaded.");

        // Extract physical transform parameters with safe defaults
        const physicalTransform = {
            ltv1: imageData.ltv1 ?? 0,
            ltv2: imageData.ltv2 ?? 0,
            ltm1_1: imageData.ltm1_1 ?? 1,
            ltm2_2: imageData.ltm2_2 ?? 1
        };
        
        const fileContent = await serializeDS9Regions(
            regions, format, imageData.width, imageData.height, pixToWorld,
            imageData.pixScale || null, physicalTransform
        );

        const blob = new Blob([fileContent], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName ? fileName.replace(/\.fits$/i, '') : 'fviewer'}.reg`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleLoadRegions = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !imageData) return;

        // Extract physical transform parameters with safe defaults
        const physicalTransform = {
            ltv1: imageData.ltv1 ?? 0,
            ltv2: imageData.ltv2 ?? 0,
            ltm1_1: imageData.ltm1_1 ?? 1,
            ltm2_2: imageData.ltm2_2 ?? 1
        };

        const text = await file.text(); 
        const loadedRegions = await parseDS9Regions(
            text, imageData.width, imageData.height, pixToWorld, worldToPix,
            imageData.pixScale || null, physicalTransform
        );
        
        setRegions((prev: Region[]) => [...prev, ...loadedRegions]);
        if (regionInputRef.current) regionInputRef.current.value = ''; 
    };

    return (
        // 1. App Layout: Full height, flex column, hide overflow
        <div className="vh-100 d-flex flex-column overflow-hidden" style={{ backgroundColor: 'var(--fv-bg)', color: 'var(--fv-text)' }}>
            
            {/* Hidden File Input */}
            <input type="file" ref={fileInputRef} accept={FITS_FORMATS} style={{ display: 'none' }} onChange={handleFileUpload} />
            <input type="file" ref={regionInputRef} accept=".reg,.txt" style={{ display: 'none' }} onChange={handleLoadRegions} />

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
                                    {isConnected && (
                                        <li><button className="dropdown-item fv-dropdown-item" onClick={() => setServerModalMode('fits')}><i className="bi bi-plug-fill"></i> Open From Server...</button></li>
                                    )}
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
                                                    isConnected={isConnected}
                                                    checkWcs={checkWcs} pixToWorld={pixToWorld}
                                                    regions={regions}
                                                    setRegions={setRegions}
                                                    onSaveRegions={handleSaveRegions}
                                                    onLoadRegions={() => regionInputRef.current?.click()}
                                                    onLoadServerRegions={() => setServerModalMode('region')}
                                                    onRegionChange={handleRegionChange}
                                                    colormap={colormap}
                                                    setColormap={setColormap}
                                                    stretch={stretch}
                                                    setStretch={setStretch}
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
            <ServerFileModal 
                isOpen={serverModalMode !== null}
                mode={serverModalMode}
                onClose={() => setServerModalMode(null)} 
                onFileSelect={handleServerFileSelect}
            />
        </div>
    );
}

export default App;