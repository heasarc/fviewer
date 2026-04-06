import React, { useState, useEffect, useRef } from 'react';
import { useFits } from './hooks/useFits';
import { VirtualTable } from './components/VirtualTable';
import { FitsImage } from './components/FitsImage';
import { FitsPlot } from './components/FitsPlot';

function App() {
    const { openFile, moveToHDU, getTableInfo, readColumn, writeCell, saveFile, readImage, getHduList, checkWcs, pixToWorld } = useFits();
    
    // File & HDU State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState("No file loaded");
    const [hduList, setHduList] = useState<any[]>([]);
    const [activeHdu, setActiveHdu] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Data State
    const [tableInfo, setTableInfo] = useState<any>(null);
    const [tableData, setTableData] = useState<Record<string, any[]>>({});
    const [imageData, setImageData] = useState<any>(null);
    const [plotX, setPlotX] = useState<string>('');
    const [plotY, setPlotY] = useState<string>('');

    // 1. File Upload Handler
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        setIsLoading(true);
        const buffer = await file.arrayBuffer();
        
        try {
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
            // Reset input so the same file can be selected again if needed
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // 2. Load Data when Active HDU changes
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
                    
                    const dataMap: Record<string, any[]> = {};
                    for (let i = 1; i <= info.numCols; i++) {
                        const colResult = await readColumn(i);
                        if (colResult && colResult.data) {
                            dataMap[info.columns[i-1].name] = colResult.data;
                        } else {
                            dataMap[info.columns[i-1].name] = new Array(info.numRows).fill('Unsupported');
                        }
                    }
                    setTableData(dataMap);
                    
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

    // 3. Cell Edit & Save Handlers
    const handleCellEdit = async (colName: string, colNum: number, rowIndex: number, newValue: string) => {
        try {
            const numericValue = Number(newValue);
            if (isNaN(numericValue)) {
                alert("Only numeric edits are supported in this demo.");
                return;
            }
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
            alert("Failed to write cell.");
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
            alert("Failed to save file.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fv-layout">
            
            {/* Hidden File Input */}
            <input type="file" ref={fileInputRef} accept=".fits,.fit,.fts" style={{ display: 'none' }} onChange={handleFileUpload} />

            {/* Top Menubar */}
            <div className="fv-menubar pe-3">
                <div className="fv-logo">
                    <i className="bi bi-stars"></i> FViewer
                </div>

                <div className="dropdown h-100">
                    <button className="fv-menu-btn" data-bs-toggle="dropdown">File</button>
                    <ul className="dropdown-menu fv-dropdown-menu">
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={() => fileInputRef.current?.click()}>
                                <i className="bi bi-folder2-open"></i> Open Local File...
                            </button>
                        </li>
                        <li><hr className="dropdown-divider border-secondary my-1" /></li>
                        <li>
                            <button className="dropdown-item fv-dropdown-item" onClick={handleSave} disabled={hduList.length === 0 || isLoading}>
                                <i className="bi bi-save"></i> Save Edited FITS
                            </button>
                        </li>
                    </ul>
                </div>

                <div className="dropdown h-100">
                    <button className="fv-menu-btn" data-bs-toggle="dropdown">Edit</button>
                    <ul className="dropdown-menu fv-dropdown-menu">
                        <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-card-heading"></i> Edit Header</button></li>
                        <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-layout-three-columns"></i> Manage Columns</button></li>
                    </ul>
                </div>

                <div className="dropdown h-100">
                    <button className="fv-menu-btn" data-bs-toggle="dropdown">View</button>
                    <ul className="dropdown-menu fv-dropdown-menu">
                        <li><button className="dropdown-item fv-dropdown-item"><i className="bi bi-aspect-ratio"></i> Reset View</button></li>
                    </ul>
                </div>

                <div className="ms-auto d-flex align-items-center gap-3">
                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>{fileName}</span>
                    {isLoading && <div className="spinner-border spinner-border-sm text-primary" role="status"></div>}
                </div>
            </div>

            {/* IDE Tabs for HDUs */}
            <div className="fv-tabs-container">
                {hduList.length === 0 ? (
                    <div className="fv-tab text-muted fst-italic cursor-default">No file loaded</div>
                ) : (
                    hduList.map((hdu) => (
                        <button 
                            key={hdu.index}
                            className={`fv-tab ${activeHdu === hdu.index ? 'active' : ''} ${hdu.type === 'empty' ? 'text-muted' : ''}`}
                            onClick={() => setActiveHdu(hdu.index)}
                        >
                            {hdu.extname} <span className="opacity-50 ms-2" style={{ fontSize: '0.7rem' }}>[{hdu.type.toUpperCase()}]</span>
                        </button>
                    ))
                )}
            </div>

            {/* Main Workspace Area */}
            <div className="flex-grow-1 overflow-auto p-3 d-flex flex-column">
                {activeHdu && (
                    <div className="fade-in d-flex flex-column flex-grow-1 gap-3">
                        
                        {hduList.find(h => h.index === activeHdu)?.type === 'empty' && (
                            <div className="alert alert-secondary border-secondary bg-dark text-white">
                                <i className="bi bi-info-circle me-2"></i> This HDU contains no data (NAXIS=0).
                            </div>
                        )}

                        {/* Image Viewer */}
                        {imageData && imageData.width > 0 && (
                            <div className="d-flex justify-content-center w-100 mb-3">
                                {/* Rigid width and height constraints */}
                                <div className="fv-panel-box d-flex flex-column w-100" style={{ maxWidth: '800px', height: '650px' }}>
                                    <div className="fv-panel-header">
                                        <span><i className="bi bi-image me-2"></i> Image Display</span>
                                    </div>
                                    <div className="flex-grow-1 position-relative d-flex flex-column" style={{ minHeight: 0 }}>
                                        <FitsImage 
                                            data={imageData.data} 
                                            width={imageData.width} 
                                            height={imageData.height} 
                                            checkWcs={checkWcs}
                                            pixToWorld={pixToWorld}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Table Workspace */}
                        {tableInfo && (
                            <div className="row g-3 flex-grow-1">
                                {/* Table Left Side */}
                                <div className="col-lg-7 d-flex flex-column">
                                    <div className="fv-panel-box d-flex flex-column flex-grow-1">
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
                                                containerHeight={undefined} 
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Plotter Right Side */}
                                <div className="col-lg-5 d-flex flex-column">
                                    <div className="fv-panel-box d-flex flex-column flex-grow-1">
                                        <div className="fv-panel-header">
                                            <span><i className="bi bi-graph-up me-2"></i> Plotter</span>
                                            <div className="d-flex gap-2">
                                                <div className="fv-input-group">
                                                    <span className="fv-input-label">X</span>
                                                    <select className="fv-select" value={plotX} onChange={(e) => setPlotX(e.target.value)}>
                                                        {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                                <div className="fv-input-group">
                                                    <span className="fv-input-label">Y</span>
                                                    <select className="fv-select" value={plotY} onChange={(e) => setPlotY(e.target.value)}>
                                                        {tableInfo.columns.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="p-2 flex-grow-1">
                                            {plotX && plotY && tableData[plotX] && tableData[plotY] ? (
                                                <FitsPlot xData={tableData[plotX]} yData={tableData[plotY]} xLabel={plotX} yLabel={plotY} />
                                            ) : (
                                                <div className="text-muted text-center py-5">Select columns to plot</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;