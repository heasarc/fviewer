// Copyright 2026, University of Maryland, All Rights Reserved

import { FitsFile } from 'wasm-cfitsio'; 

// Store the active file in the worker's memory
let activeFile: FitsFile | null = null;

// Cache columns in the worker so we don't repeatedly ask WASM for the whole file
let tableCache: Record<number, any> = {};

// Helper function to safely read and isolate WASM memory
function getCachedColumn(colNum: number) {
    if (!tableCache[colNum]) {
        const rawResult = activeFile!.readColumn(colNum);
        
        let safeData;
        // TypeScript Fix: Use ArrayBuffer.isView to safely check for TypedArrays
        if (rawResult && rawResult.data && ArrayBuffer.isView(rawResult.data)) {
            // Cast to any to bypass TS complaints, slice to isolate memory
            safeData = (rawResult.data as any).slice(); 
        } else {
            // It's a standard JS Array (e.g., TSTRING column)
            safeData = rawResult ? rawResult.data : [];
        }

        tableCache[colNum] = {
            ...rawResult,
            data: safeData
        };
    }
    return tableCache[colNum];
}

// Listen for messages from the main React thread
self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        switch (action) {
            case 'OPEN_FILE': {
                // payload is the raw Uint8Array from the file input
                if (activeFile) activeFile.close(); // Clean up old file
                activeFile = await FitsFile.open(payload);
                tableCache = {}; 
                const numHDUs = activeFile.getNumHDUs();
                
                self.postMessage({ id, success: true, data: { numHDUs } });
                break;
            }

            case 'READ_HEADER': {
                if (!activeFile) throw new Error("No file opened");
                const header = activeFile.readHeader();
                self.postMessage({ id, success: true, data: header });
                break;
            }

            case 'UPDATE_KEYWORD': {
                if (!activeFile) throw new Error("No file opened");
                const { key, value, isNumeric, comment } = payload;
                
                // Use the appropriate cfitsio binding based on the data type
                let status;
                if (isNumeric) {
                    status = activeFile.updateKeyDouble(key, Number(value), comment || "");
                } else {
                    status = activeFile.updateKeyString(key, String(value), comment || "");
                }

                if (status !== 0) throw new Error(`Failed to update keyword ${key}. Status: ${status}`);
                self.postMessage({ id, success: true });
                break;
            }

            case 'GET_HDU_LIST': {
                if (!activeFile) throw new Error("No file opened");
                const numHDUs = activeFile.getNumHDUs();
                const hduList = [];
                
                for (let i = 1; i <= numHDUs; i++) {
                    activeFile.moveToHDU(i);
                    // Clean up the string by removing FITS quotes and spaces
                    const xtension = (activeFile.readKeyword("XTENSION") || "").replace(/'/g, '').trim();
                    const extname = (activeFile.readKeyword("EXTNAME") || "").replace(/'/g, '').trim() || `HDU ${i}`;
                    const naxis = parseInt(activeFile.readKeyword("NAXIS") || "0", 10);
                    
                    let type = 'unknown';
                    if (i === 1) {
                        type = naxis > 0 ? 'image' : 'empty'; // Primary HDU is an image, but might be 0 pixels
                    } else if (xtension === 'IMAGE') {
                        type = naxis > 0 ? 'image' : 'empty';
                    } else if (xtension === 'BINTABLE' || xtension === 'TABLE') {
                        type = 'table';
                    }

                    hduList.push({ index: i, type, extname, naxis });
                }
                
                self.postMessage({ id, success: true, data: hduList });
                break;
            }

            case 'MOVE_TO_HDU': {
                if (!activeFile) throw new Error("No file opened");
                const status = activeFile.moveToHDU(payload.hduNum);
                
                // Determine HDU type by reading keywords
                const xtension = activeFile.readKeyword("XTENSION")?.trim() || "";
                const isTable = xtension === "BINTABLE" || xtension === "TABLE";
                const isImage = activeFile.readKeyword("SIMPLE") === "T" || xtension === "IMAGE";

                self.postMessage({ id, success: true, data: { status, isTable, isImage } });
                break;
            }

            case 'GET_TABLE_INFO': {
                if (!activeFile) throw new Error("No file opened");
                const numRows = activeFile.getNumRows();
                const numCols = activeFile.getNumCols();
                
                // Fetch schema for all columns
                const columns = [];
                for (let i = 1; i <= numCols; i++) {
                    columns.push(activeFile.getColumnInfo(i));
                }

                self.postMessage({ id, success: true, data: { numRows, numCols, columns } });
                break;
            }

            // --- FULL COLUMN (FOR PLOTTER) ---
            case 'READ_COLUMN': {
                if (!activeFile) throw new Error("No file opened");
                
                const cached = getCachedColumn(payload.colNum);
                const transferables: ArrayBuffer[] = [];
                let sendData = { ...cached };
                
                if (cached.data.buffer) {
                    // Clone our safe cache so we don't lose it when transferring
                    const transferClone = cached.data.slice();
                    transferables.push(transferClone.buffer);
                    sendData.data = transferClone;
                }

                (self as any).postMessage({ id, success: true, data: sendData }, transferables);
                break;
            }

            // --- CHUNKED ROWS (FOR VIRTUAL TABLE) ---
            case 'READ_TABLE_CHUNK': {
                if (!activeFile) throw new Error("No file opened");
                const { startRow, endRow } = payload;
                const numCols = activeFile.getNumCols();
                
                const chunkData: Record<string, any> = {};
                const transferables: ArrayBuffer[] = [];

                for (let i = 1; i <= numCols; i++) {
                    const colInfo = activeFile.getColumnInfo(i);
                    if (!colInfo) continue;
                    
                    const cached = getCachedColumn(i);

                    if (cached.data.buffer) {
                        // Slice creates a new ArrayBuffer representing just the chunk
                        const chunk = cached.data.slice(startRow, endRow + 1);
                        chunkData[colInfo.name] = chunk;
                        transferables.push(chunk.buffer);
                    } else if (Array.isArray(cached.data)) {
                        // Standard JS array chunking (Strings)
                        chunkData[colInfo.name] = cached.data.slice(startRow, endRow + 1);
                    } else {
                        chunkData[colInfo.name] = new Array((endRow - startRow) + 1).fill('Unsupported');
                    }
                }

                (self as any).postMessage({ id, success: true, data: chunkData }, transferables);
                break;
            }

            case 'WRITE_CELL': {
                if (!activeFile) throw new Error("No file opened");
                // payload: { colNum (1-indexed), rowNum (1-indexed), value }
                const { colNum, rowNum, value } = payload;
                const status = activeFile.writeCell(colNum, rowNum, value);
                
                if (status !== 0) throw new Error(`Write failed with status ${status}`);
                self.postMessage({ id, success: true, data: { status } });
                break;
            }

            case 'SAVE_FILE': {
                if (!activeFile) throw new Error("No file opened");
                
                // activeFile.save() flushes cfitsio and returns a Uint8Array
                const fileBytes = activeFile.save(); 
                
                // Send the bytes back. (Modern browsers transfer Uint8Array efficiently)
                self.postMessage({ id, success: true, data: fileBytes });
                break;
            }

            case 'READ_IMAGE': {
                if (!activeFile) throw new Error("No file opened");
                
                const imageResult = activeFile.readImage();
                if (!imageResult) throw new Error("Current HDU is not an image");
                
                const width = parseInt(activeFile.readKeyword("NAXIS1") || "0", 10);
                const height = parseInt(activeFile.readKeyword("NAXIS2") || "0", 10);

                const transferables = imageResult.data?.buffer ? [imageResult.data.buffer] : [];

                // Fix: Cast self to any here as well
                (self as any).postMessage({ 
                    id, 
                    success: true, 
                    data: { ...imageResult, width, height } 
                }, transferables);
                break;
            }

            case 'CHECK_WCS': {
                if (!activeFile) throw new Error("No file opened");
                const hasWCS = activeFile.hasWCS();
                self.postMessage({ id, success: true, data: hasWCS });
                break;
            }

            case 'PIX_TO_WORLD': {
                if (!activeFile) throw new Error("No file opened");
                const { x, y } = payload;
                const coords = activeFile.pixToWorld(x, y); // returns {ra, dec} or null
                self.postMessage({ id, success: true, data: coords });
                break;
            }

            case 'WORLD_TO_PIX': {
                if (!activeFile) throw new Error("No file opened");
                const { ra, dec } = payload;
                const coords = activeFile.worldToPix(ra, dec); // returns {y, y} or null
                self.postMessage({ id, success: true, data: coords });
                break;
            }

            case 'PIX_SCALE': {
                if (!activeFile) throw new Error("No file opened");
                const scale = activeFile.getPixelScale();
                self.postMessage({ id, success: true, data: scale });
                break;
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        self.postMessage({ id, success: false, error: (error as Error).message });
    }
};