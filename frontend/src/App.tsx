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
import { FitsPlot } from './components/FitsPlot';
import { FitsHeaderModal } from './components/FitsHeaderModal';
import { ServerFileModal } from './components/ServerFileModal';
import fviewerLogo from '/fviewer-logo.svg';
import { FITS_FORMATS, ALLOWED_EXTS } from './utils/constants';

function App() {

    // Get everything we need from the Core Context
    const { 
        fitsWorker, fileName, setFileName, hduList, setHduList, 
        activeHdu, setActiveHdu, tableInfo, setTableInfo, 
        imageData, setImageData, isLoading, setIsLoading 
    } = useCore();

    // Deconstruct the worker methods we need for this file
    const { openFile, moveToHDU, getTableInfo, readColumn, writeCell, saveFile, readImage, getHduList, 
          checkWcs, pixToWorld, worldToPix, readHeader, updateKeyword, readTableChunk } = fitsWorker;
    
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Data State
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const [plotX, setPlotX] = useState<string>('');
    const [plotY, setPlotY] = useState<string>('');
    const [isPlotterOpen, setIsPlotterOpen] = useState(false);
    const isPlotterOpenRef = useRef(isPlotterOpen);
    const [plotterWidth, setPlotterWidth] = useState(450); // Default width
    const [isResizingPlotter, setIsResizingPlotter] = useState(false);
    const [plotXErr, setPlotXErr] = useState<string>('');
    const [plotYErr, setPlotYErr] = useState<string>('');
    const [plotType, setPlotType] = useState<'scatter' | 'histogram'>('scatter');
    const [fullPlotData, setFullPlotData] = useState<Record<string, any>>({});
    const fetchedPlotColumns = useRef<Set<string>>(new Set());
    const [plotPointSize, setPlotPointSize] = useState<number>(2);
    const [plotPointColor, setPlotPointColor] = useState<string>('#7ec8e3');
    const [plotSubsetMode, setPlotSubsetMode] = useState<'all' | 'range' | 'random'>('all');
    const [plotSubsetStart, setPlotSubsetStart] = useState<number>(0);
    const [plotSubsetEnd, setPlotSubsetEnd] = useState<number>(10000);
    const [plotSubsetRandomN, setPlotSubsetRandomN] = useState<number>(10000);
    const [activeRegionPixels, setActiveRegionPixels] = useState<number[] | null>(null);
    
    const [colormap, setColormap] = useState('gray');
    const [stretch, setStretch] = useState('linear');

    const [isHeaderModalOpen, setIsHeaderModalOpen] = useState(false);
    const [rawHeaderString, setRawHeaderString] = useState('');

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

                const headerStr = await readHeader();
                setRawHeaderString(headerStr);

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
                    
                    if (info.numCols >= 2) {
                        setPlotX(info.columns[0].name);
                        setPlotY(info.columns[1].name);
                    }
                }
            } catch (error) {
                console.error("Failed to load HDU data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadHduData();
    }, [activeHdu]);

    // Fetch full columns ONLY when they are selected AND the plotter is visible
    useEffect(() => {
        if (!activeHdu || !tableInfo || !isPlotterOpen) return; 

        const columnsToFetch = [plotX, plotY, plotXErr, plotYErr].filter(Boolean);
        
        columnsToFetch.forEach(async (colName) => {
            // CRITICAL FIX: Use a ref to track what we've ALREADY asked the worker for
            // This prevents React from spamming the worker with 40MB requests
            if (!colName || fetchedPlotColumns.current.has(colName)) return; 
            
            fetchedPlotColumns.current.add(colName); // Mark as fetching

            const colIndex = tableInfo.columns.findIndex((c: any) => c.name === colName) + 1;
            if (colIndex > 0) {
                try {
                    const result = await readColumn(colIndex);
                    if (result && result.data) {
                        setFullPlotData(prev => ({ ...prev, [colName]: result.data }));
                    }
                } catch (e) {
                    console.error(`Failed to load full column ${colName}`, e);
                    fetchedPlotColumns.current.delete(colName); // Retry later if failed
                }
            }
        });
    }, [plotX, plotY, plotXErr, plotYErr, activeHdu, tableInfo, readColumn, isPlotterOpen]);

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

    // --- PLOTTER RESIZE LOGIC ---
    useEffect(() => {
        if (!isResizingPlotter) return;

        const handlePointerMove = (e: PointerEvent) => {
            // Sidebar is on the right, so its width is (Total Window Width - Mouse X)
            const newWidth = document.body.clientWidth - e.clientX;
            
            // Constrain it so it doesn't crush the main view or disappear entirely
            if (newWidth > 300 && newWidth < document.body.clientWidth - 300) {
                setPlotterWidth(newWidth);
            }
        };

        const handlePointerUp = () => setIsResizingPlotter(false);

        // Attach to window so fast drags don't drop the lock
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizingPlotter]);

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
                                    <li><button className="dropdown-item fv-dropdown-item" onClick={() => setIsHeaderModalOpen(true)} disabled={!activeHdu}><i className="bi bi-card-heading"></i> Edit Header</button></li>
                                    <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-layout-three-columns"></i> Manage Columns</button></li>
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
                                    <li><span className="dropdown-item fv-dropdown-item">FViewer Version: 0.2.6</span></li>
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
                            <button 
                                className={`btn menubar-btn border-0 px-2 ${isPlotterOpen ? 'fv-text-primary' : 'fv-text-muted'}`} 
                                onClick={() => {
                                    const willOpen = !isPlotterOpen;
                                    setIsPlotterOpen(willOpen);
                                    // JIT trigger! If we just opened the plotter and an Image region is selected, run the math now!
                                    if (willOpen && imageData && regions.length > 0) {
                                        // Hacky but safe trigger to force the math calculation
                                        setTimeout(() => handleRegionChange(regions[regions.length - 1]), 0);
                                    }
                                }}
                                title="Toggle Plotter Sidebar"
                            >
                                <i className="bi bi-layout-sidebar-reverse fs-5"></i>
                            </button>
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

                    {/* --- DRAGGABLE RESIZER HANDLE --- */}
                    {isPlotterOpen && (
                        <div 
                            className="flex-shrink-0"
                            style={{
                                width: '5px',
                                cursor: 'col-resize',
                                backgroundColor: isResizingPlotter ? 'var(--fv-accent)' : 'transparent', // Highlights cyan when grabbed!
                                borderLeft: '1px solid var(--fv-border)',
                                zIndex: 10,
                                transition: 'background-color 0.2s'
                            }}
                            onPointerDown={(e) => {
                                e.preventDefault(); // Prevent text highlighting while dragging
                                setIsResizingPlotter(true);
                            }}
                            // Hover effect
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--fv-panel-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isResizingPlotter ? 'var(--fv-accent)' : 'transparent'}
                        />
                    )}

                    {/* Right Sidebar: Global Plotter */}
                    <div 
                        className="d-flex flex-column flex-shrink-0" 
                        style={{ 
                            width: isPlotterOpen ? `${plotterWidth}px` : '0px', 
                            maxWidth: '100%', 
                            backgroundColor: 'var(--fv-panel)', 
                            // Disable animation WHILE resizing for instant 60fps response
                            transition: isResizingPlotter ? 'none' : 'width 0.3s ease-in-out',
                            overflow: 'hidden'
                        }}
                    >
                        {/* Inner container uses dynamic plotterWidth to stay rigid during animation */}
                        <div style={{ width: `${plotterWidth}px`, minWidth: `${plotterWidth}px` }} className="d-flex flex-column h-100 p-3">
                            <div className="d-flex align-items-center justify-content-between mb-3 text-white fw-bold border-bottom pb-2" style={{ borderColor: 'var(--fv-border)' }}>
                                <span><i className="bi bi-graph-up me-2 text-primary"></i> Analysis Plotter</span>
                                <button className="btn-close btn-close-white" style={{ fontSize: '0.7rem' }} onClick={() => setIsPlotterOpen(false)}></button>
                            </div>

                            {/* Plot Controls based on active HDU type */}
                            <div className="flex-grow-1 d-flex flex-column">
                                {tableInfo ? (
                                    // TABLE PLOTTING UI
                                    <>
                                        <div className="input-group input-group-sm mb-2 shadow-sm">
                                            <span className="input-group-text border-0 bg-dark text-white"><i className="bi bi-bar-chart"></i></span>
                                            <select className="form-select border-0 bg-secondary text-white fw-bold" value={plotType} onChange={(e) => setPlotType(e.target.value as 'scatter' | 'histogram')}>
                                                <option value="scatter">Scatter Plot</option>
                                                <option value="histogram">1D Histogram</option>
                                            </select>
                                        </div>

                                        {/* Axes Selectors (Perfectly aligned 2x2 Grid) */}
                                        <div className="row g-2 mb-3">
                                            {/* Left Column: X and ErrX */}
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm mb-2">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>X</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotX} onChange={(e) => setPlotX(e.target.value)}>
                                                        <option value="">-- Select --</option>
                                                        {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-plus-minus me-1"></i> ErrX</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotXErr} onChange={(e) => setPlotXErr(e.target.value)} disabled={plotType === 'histogram'}>
                                                        <option value="">None</option>
                                                        {plotType !== 'histogram' && tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Right Column: Y and ErrY */}
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm mb-2">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Y</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotY} onChange={(e) => setPlotY(e.target.value)} disabled={plotType === 'histogram'}>
                                                        {plotType === 'histogram' ? <option>Counts</option> : (
                                                            <>
                                                                <option value="">-- Select --</option>
                                                                {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                            </>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-plus-minus me-1"></i> ErrY</span>
                                                    <select className="form-select border-0 bg-secondary text-white" value={plotYErr} onChange={(e) => setPlotYErr(e.target.value)} disabled={plotType === 'histogram'}>
                                                        <option value="">None</option>
                                                        {plotType !== 'histogram' && tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        {/* Styling Selectors (Size & Color) */}
                                        <div className="row g-2 mb-3">
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Size</span>
                                                    <input 
                                                        type="number" 
                                                        className="form-control border-0 bg-secondary text-white" 
                                                        value={plotPointSize} 
                                                        onChange={(e) => setPlotPointSize(Number(e.target.value))} 
                                                        min="1" max="10" 
                                                        disabled={plotType === 'histogram'}
                                                    />
                                                </div>
                                            </div>
                                            <div className="col-6">
                                                <div className="input-group input-group-sm shadow-sm">
                                                    <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Color</span>
                                                    <input 
                                                        type="color" 
                                                        className="form-control form-control-color border-0 bg-secondary w-10 px-1 py-1" 
                                                        value={plotPointColor} 
                                                        onChange={(e) => setPlotPointColor(e.target.value)} 
                                                        title="Choose point color" 
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Data Subset Selectors */}
                                        <div className="input-group input-group-sm shadow-sm mb-2">
                                            <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}><i className="bi bi-funnel"></i></span>
                                            <select className="form-select border-0 bg-secondary text-white fw-bold" value={plotSubsetMode} onChange={(e) => setPlotSubsetMode(e.target.value as 'all' | 'range' | 'random')}>
                                                <option value="all">Plot All Rows</option>
                                                <option value="range">Row Range</option>
                                                <option value="random">Random Sample</option>
                                            </select>
                                        </div>

                                        {plotSubsetMode === 'range' && (
                                            <div className="mb-3 p-2 bg-dark rounded border shadow-sm" style={{ borderColor: 'var(--fv-border)' }}>
                                                
                                                {/* Start Slider + Input */}
                                                <div className="d-flex align-items-center mb-2">
                                                    <span className="text-white me-2 fw-bold" style={{ width: '40px', fontSize: '0.75rem' }}>Start</span>
                                                    <input 
                                                        type="range" 
                                                        className="form-range flex-grow-1" 
                                                        min="0" 
                                                        max={tableInfo.numRows - 1} 
                                                        value={plotSubsetStart} 
                                                        onChange={(e) => setPlotSubsetStart(Number(e.target.value))} 
                                                    />
                                                    <input 
                                                        type="number" 
                                                        className="form-control form-control-sm ms-2 bg-secondary text-white border-0 text-end" 
                                                        style={{ width: '80px', fontSize: '0.75rem' }} 
                                                        value={plotSubsetStart} 
                                                        onChange={(e) => setPlotSubsetStart(Number(e.target.value))} 
                                                        min="0"
                                                        max={tableInfo.numRows - 1}
                                                    />
                                                </div>

                                                {/* End Slider + Input */}
                                                <div className="d-flex align-items-center">
                                                    <span className="text-white me-2 fw-bold" style={{ width: '40px', fontSize: '0.75rem' }}>End</span>
                                                    <input 
                                                        type="range" 
                                                        className="form-range flex-grow-1" 
                                                        min="0" 
                                                        max={tableInfo.numRows - 1} 
                                                        value={plotSubsetEnd} 
                                                        onChange={(e) => setPlotSubsetEnd(Number(e.target.value))} 
                                                    />
                                                    <input 
                                                        type="number" 
                                                        className="form-control form-control-sm ms-2 bg-secondary text-white border-0 text-end" 
                                                        style={{ width: '80px', fontSize: '0.75rem' }} 
                                                        value={plotSubsetEnd} 
                                                        onChange={(e) => setPlotSubsetEnd(Number(e.target.value))} 
                                                        min="0"
                                                        max={tableInfo.numRows - 1}
                                                    />
                                                </div>

                                            </div>
                                        )}

                                        {plotSubsetMode === 'random' && (
                                            <div className="input-group input-group-sm shadow-sm mb-3">
                                                <span className="input-group-text border-0 bg-dark text-white justify-content-center" style={{ width: '65px' }}>Size</span>
                                                <input type="number" className="form-control border-0 bg-secondary text-white" value={plotSubsetRandomN} onChange={(e) => setPlotSubsetRandomN(Number(e.target.value))} min="1" />
                                            </div>
                                        )}
                                        
                                        <div className="flex-grow-1 bg-dark rounded border d-flex flex-column shadow-sm" style={{ borderColor: 'var(--fv-border)', minHeight: '300px' }}>
                                            {plotX && (plotType === 'histogram' || plotY) && fullPlotData[plotX] ? (
                                                <div className="p-2 w-100 h-100">
                                                    <FitsPlot 
                                                        xData={fullPlotData[plotX]} 
                                                        yData={plotType === 'scatter' && plotY ? fullPlotData[plotY] : undefined} 
                                                        xErrData={plotType === 'scatter' && plotXErr ? fullPlotData[plotXErr] : undefined}
                                                        yErrData={plotType === 'scatter' && plotYErr ? fullPlotData[plotYErr] : undefined}
                                                        xLabel={plotX} 
                                                        yLabel={plotType === 'scatter' ? plotY : 'Counts'} 
                                                        plotType={plotType}
                                                        pointSize={plotPointSize}
                                                        pointColor={plotPointColor}
                                                        subsetMode={plotSubsetMode}
                                                        subsetRange={[plotSubsetStart, plotSubsetEnd]}
                                                        subsetRandomN={plotSubsetRandomN} 
                                                    />
                                                </div>
                                            ) : (
                                                <div className="m-auto text-muted fst-italic">Select columns to plot</div>
                                            )}
                                        </div>
                                    </>
                                ) : imageData ? (
                                    // IMAGE PLOTTING UI
                                    <div className="d-flex flex-column h-100 w-100">
                                        <div className="alert bg-dark text-white border-secondary shadow-sm mb-3" style={{ fontSize: '0.85rem' }}>
                                            <i className="bi bi-info-circle text-primary me-2"></i>
                                            Select a region on the image to view its pixel distribution.
                                        </div>

                                        <div className="flex-grow-1 bg-dark rounded border d-flex flex-column shadow-sm" style={{ borderColor: 'var(--fv-border)', minHeight: '300px' }}>
                                            {activeRegionPixels && activeRegionPixels.length > 0 ? (
                                                <div className="p-2 w-100 h-100">
                                                    <FitsPlot 
                                                        xData={activeRegionPixels} 
                                                        xLabel="Pixel Intensity" 
                                                        plotType="histogram" 
                                                        numBins={50}
                                                        title="Region Histogram"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="m-auto text-center fv-text-muted p-4">
                                                    <i className="bi bi-bounding-box display-4 d-block mb-3 opacity-50"></i>
                                                    <p>No region selected.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="m-auto fv-text-muted fst-italic">No data to plot</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <FitsHeaderModal 
                isOpen={isHeaderModalOpen} 
                onClose={() => setIsHeaderModalOpen(false)} 
                rawHeader={rawHeaderString} 
                onUpdateKeyword={async (key, value, isNum, comment) => {
                    await updateKeyword(key, value, isNum, comment);
                    // Refresh the header display instantly!
                    const newHeader = await readHeader();
                    setRawHeaderString(newHeader);
                }}
            />
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