// Copyright 2026, University of Maryland, All Rights Reserved

/**
 * @fileoverview Web Worker for FViewer.
 * Runs `cfitsio` / `wcslib` via WebAssembly in a background thread.
 * This prevents intensive parsing, WCS calculations, and data fetching 
 * from freezing the main React UI thread.
 */

import { FitsFile } from 'wasm-cfitsio'; 

/** 
 * Holds the current active FITS file instance in the worker's memory. 
 * Must be closed before opening a new file to prevent WASM memory leaks.
 */
let activeFile: FitsFile | null = null;

/** 
 * Caches full-column reads to avoid repeatedly asking WASM to parse the same data.
 * Keyed by column index (1-based generally, depending on cfitsio mapping).
 */
let tableCache: Record<number, any> = {};

/**
 * Helper function to safely read and isolate WASM memory for full columns.
 * 
 * CRITICAL MEMORY BEHAVIOR: 
 * When WASM returns a TypedArray (like Float32Array), it is typically a "view" 
 * directly into the C++ heap. If the C++ side frees or reallocates that memory, 
 * the JS view becomes corrupted. To prevent this, we immediately call `.slice()` 
 * to clone the data out of the WASM heap into pure JS memory.
 * 
 * @param {number} colNum - The index of the column to read.
 * @returns {Object} The cached column data with a safe, cloned buffer.
 */
function getCachedColumn(colNum: number) {
    if (!tableCache[colNum]) {
        // Get total rows to read the full column
        const totalRows = activeFile!.getNumRows();
        
        // Read from row 0 (or 1 depending on JS-to-C++ index mapping) to totalRows
        const rawResult = activeFile!.readColumn(colNum, 0, totalRows);
        
        let safeData;
        if (rawResult && rawResult.data && ArrayBuffer.isView(rawResult.data)) {
            // Clone instantly to protect against C++ memory corruption/reallocation
            safeData = (rawResult.data as any).slice(); 
        } else {
            safeData = rawResult ? rawResult.data : [];
        }

        tableCache[colNum] = {
            ...rawResult,
            data: safeData
        };
    }
    return tableCache[colNum];
}

/**
 * Main message router for commands sent from the React thread.
 * Uses `postMessage` to send data back. Heavy payloads use the second argument 
 * (Transferable Objects) to pass ownership of ArrayBuffers without copying, 
 * resulting in 0ms transfer times to the main UI thread.
 */
self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        switch (action) {
            case 'OPEN_FILE': {
                // payload is the raw Uint8Array from the file input
                if (activeFile) activeFile.close(); // Clean up old file to free WASM memory
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

                // CLEAR THE CACHE for the new HDU to prevent reading old data!
                tableCache = {};
                
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
                    // Clone our safe JS cache so we don't lose access to it in the worker 
                    // when transferring ownership of the ArrayBuffer to the main thread.
                    const transferClone = cached.data.slice();
                    transferables.push(transferClone.buffer);
                    sendData.data = transferClone;
                }

                // Transfer ownership of the buffer array for 0ms main-thread transfer
                (self as any).postMessage({ id, success: true, data: sendData }, transferables);
                break;
            }

            // --- CHUNKED ROWS (FOR VIRTUAL TABLE) ---
            case 'READ_TABLE_CHUNK': {
                if (!activeFile) throw new Error("No file opened");
                const { startRow, endRow } = payload;
                
                const numRowsToRead = (endRow - startRow) + 1;
                const numCols = activeFile.getNumCols();
                
                const chunkData: Record<string, any> = {};
                const transferables: ArrayBuffer[] = [];

                for (let i = 1; i <= numCols; i++) {
                    const colInfo = activeFile.getColumnInfo(i);
                    if (!colInfo) continue;
                    
                    // Call the WASM method directly for the specific chunk
                    const rawChunkResult = activeFile.readColumn(i, startRow, numRowsToRead);
                    
                    if (rawChunkResult && rawChunkResult.data && ArrayBuffer.isView(rawChunkResult.data)) {
                        // Slice it immediately to copy it out of the WASM heap safely
                        const chunkCopy = (rawChunkResult.data as any).slice();
                        chunkData[colInfo.name] = chunkCopy;
                        transferables.push(chunkCopy.buffer);
                    } else if (Array.isArray(rawChunkResult?.data)) {
                        // Standard JS Array (e.g. for String columns)
                        chunkData[colInfo.name] = rawChunkResult.data;
                    } else {
                        chunkData[colInfo.name] = new Array(numRowsToRead).fill('Unsupported');
                    }
                }

                // Push chunk to main thread using zero-copy Transferable Objects
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
                
                // activeFile.save() flushes cfitsio buffers and returns a Uint8Array
                const fileBytes = activeFile.save();

                // Transfer the buffer efficiently to the main thread for downloading
                (self as any).postMessage(
                    { id, success: true, data: fileBytes }, 
                    [fileBytes.buffer]
                );
                break;
            }

            case 'READ_IMAGE': {
                if (!activeFile) throw new Error("No file opened");
                
                const imageResult = activeFile.readImage();
                if (!imageResult) throw new Error("Current HDU is not an image");
                
                const width = parseInt(activeFile.readKeyword("NAXIS1") || "0", 10);
                const height = parseInt(activeFile.readKeyword("NAXIS2") || "0", 10);

                // Extract Physical Coordinate Transformation keywords
                // LTV = Linear Transformation Vector (Offset)
                // LTM = Linear Transformation Matrix (Scale/Binning)
                const ltv1 = parseFloat(activeFile.readKeyword("LTV1") || "0");
                const ltv2 = parseFloat(activeFile.readKeyword("LTV2") || "0");
                const ltm1_1 = parseFloat(activeFile.readKeyword("LTM1_1") || "1");
                const ltm2_2 = parseFloat(activeFile.readKeyword("LTM2_2") || "1");

                const transferables = imageResult.data?.buffer ? [imageResult.data.buffer] : [];

                // Send massive image array directly to main thread without copying
                (self as any).postMessage({ 
                    id, 
                    success: true, 
                    data: { ...imageResult, width, height, ltv1, ltv2, ltm1_1, ltm2_2 } 
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
                const coords = activeFile.worldToPix(ra, dec); // returns {x, y} or null
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
    } catch (error: any) {
        // Safely handle standard JS errors, Emscripten strings, or Emscripten pointer exceptions
        let errorMsg = "Unknown WASM Error";
        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === 'string') {
            errorMsg = error;
        } else if (error && typeof error === 'object') {
            // Emscripten sometimes throws objects containing the C++ exception pointer
            errorMsg = error.message || JSON.stringify(error);
        }
        
        self.postMessage({ id, success: false, error: errorMsg });
    }
};