// Copyright 2026, University of Maryland, All Rights Reserved

/**
 * @fileoverview Core WebAssembly logic for FViewer.
 * Wraps `cfitsio` / `wcslib` via WebAssembly.
 * Extracted from the Web Worker to allow 100% test coverage 
 * on the main thread during tests, while running in a background
 * thread during production.
 */

import { FitsFile } from 'wasm-cfitsio'; 

export class FitsCore {
    /** 
     * Holds the current active FITS file instance in memory. 
     * Must be closed before opening a new file to prevent WASM memory leaks.
     */
    activeFile: FitsFile | null = null;

    /** 
     * Caches full-column reads to avoid repeatedly asking WASM to parse the same data.
     * Keyed by column index (1-based generally, depending on cfitsio mapping).
     */
    tableCache: Record<number, any> = {};

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
    private getCachedColumn(colNum: number) {
        if (!this.tableCache[colNum]) {
            // Get total rows to read the full column
            const totalRows = this.activeFile!.getNumRows();
            
            // Read from row 0 (or 1 depending on JS-to-C++ index mapping) to totalRows
            const rawResult = this.activeFile!.readColumn(colNum, 0, totalRows);
            
            let safeData;
            if (rawResult && rawResult.data && ArrayBuffer.isView(rawResult.data)) {
                // Clone instantly to protect against C++ memory corruption/reallocation
                safeData = (rawResult.data as any).slice(); 
            } else {
                safeData = rawResult ? rawResult.data : [];
            }

            this.tableCache[colNum] = {
                ...rawResult,
                data: safeData
            };
        }
        return this.tableCache[colNum];
    }

    /**
     * Main message router for commands sent from the React thread.
     * Returns the payload and an array of Transferable Objects.
     */
    async processCommand(action: string, payload: any): Promise<{ data?: any, transferables?: ArrayBuffer[] }> {
        switch (action) {
            case 'OPEN_FILE': {
                // payload is the raw Uint8Array from the file input
                if (this.activeFile) this.activeFile.close(); // Clean up old file to free WASM memory
                this.activeFile = await FitsFile.open(payload);
                this.tableCache = {}; 
                return { data: { numHDUs: this.activeFile.getNumHDUs() } };
            }

            case 'READ_HEADER': {
                if (!this.activeFile) throw new Error("No file opened");
                return { data: this.activeFile.readHeader() };
            }

            case 'UPDATE_KEYWORD': {
                if (!this.activeFile) throw new Error("No file opened");
                const { key, value, isNumeric, comment } = payload;
                
                // Use the appropriate cfitsio binding based on the data type
                let status;
                if (isNumeric) {
                    status = this.activeFile.updateKeyDouble(key, Number(value), comment || "");
                } else {
                    status = this.activeFile.updateKeyString(key, String(value), comment || "");
                }

                if (status !== 0) throw new Error(`Failed to update keyword ${key}. Status: ${status}`);
                return {};
            }

            case 'GET_HDU_LIST': {
                if (!this.activeFile) throw new Error("No file opened");
                const numHDUs = this.activeFile.getNumHDUs();
                const hduList = [];
                
                for (let i = 1; i <= numHDUs; i++) {
                    this.activeFile.moveToHDU(i);
                    // Clean up the string by removing FITS quotes and spaces
                    const xtension = (this.activeFile.readKeyword("XTENSION") || "").replace(/'/g, '').trim();
                    const extname = (this.activeFile.readKeyword("EXTNAME") || "").replace(/'/g, '').trim() || `HDU ${i}`;
                    const naxis = parseInt(this.activeFile.readKeyword("NAXIS") || "0", 10);

                    // Check if this is a tile-compressed image
                    const zimage = (this.activeFile.readKeyword("ZIMAGE") || "").replace(/'/g, '').trim();
                    const isCompressedImage = (zimage === 'T');
                    
                    let type = 'unknown';
                    const naxes: number[] = []; // <-- Array to hold dimension sizes

                    if (i === 1) {
                        type = naxis > 0 ? 'image' : 'empty'; 
                    } else if (isCompressedImage) {
                        // Compressed images logically act as images, even if XTENSION is BINTABLE
                        const znaxis = parseInt(this.activeFile.readKeyword("ZNAXIS") || "0", 10);
                        type = znaxis > 0 ? 'image' : 'empty';
                    } else if (xtension === 'IMAGE') {
                        type = naxis > 0 ? 'image' : 'empty';
                    } else if (xtension === 'BINTABLE' || xtension === 'TABLE') {
                        type = 'table';
                    }

                    // --- If it's an image, grab all axis sizes ---
                    if (type === 'image') {
                        if (isCompressedImage) {
                            const znaxis = parseInt(this.activeFile.readKeyword("ZNAXIS") || "0", 10);
                            for (let j = 1; j <= znaxis; j++) {
                                const dimSize = parseInt(this.activeFile.readKeyword(`ZNAXIS${j}`) || "0", 10);
                                naxes.push(dimSize);
                            }
                        } else if (naxis > 0) { // Standard uncompressed image
                            for (let j = 1; j <= naxis; j++) {
                                const dimSize = parseInt(this.activeFile.readKeyword(`NAXIS${j}`) || "0", 10);
                                naxes.push(dimSize);
                            }
                        }
                    }

                    hduList.push({ index: i, type, extname, naxes });
                }
                
                return { data: hduList };
            }

            case 'MOVE_TO_HDU': {
                if (!this.activeFile) throw new Error("No file opened");
                const status = this.activeFile.moveToHDU(payload.hduNum);

                // CLEAR THE CACHE for the new HDU to prevent reading old data!
                this.tableCache = {};
                
                // Determine HDU type by reading keywords
                const xtension = this.activeFile.readKeyword("XTENSION")?.trim() || "";
                const isTable = xtension === "BINTABLE" || xtension === "TABLE";
                const isImage = this.activeFile.readKeyword("SIMPLE") === "T" || xtension === "IMAGE";

                return { data: { status, isTable, isImage } };
            }

            case 'GET_TABLE_INFO': {
                if (!this.activeFile) throw new Error("No file opened");
                const numRows = this.activeFile.getNumRows();
                const numCols = this.activeFile.getNumCols();
                
                // Fetch schema for all columns
                const columns = [];
                for (let i = 1; i <= numCols; i++) {
                    columns.push(this.activeFile.getColumnInfo(i));
                }

                return { data: { numRows, numCols, columns } };
            }

            // --- FULL COLUMN (FOR PLOTTER) ---
            case 'READ_COLUMN': {
                if (!this.activeFile) throw new Error("No file opened");
                
                const cached = this.getCachedColumn(payload.colNum);
                const transferables: ArrayBuffer[] = [];
                let sendData = { ...cached };
                
                if (cached.data.buffer) {
                    // Clone our safe JS cache so we don't lose access to it in the worker 
                    // when transferring ownership of the ArrayBuffer to the main thread.
                    const transferClone = cached.data.slice();
                    transferables.push(transferClone.buffer as ArrayBuffer);
                    sendData.data = transferClone;
                }

                return { data: sendData, transferables };
            }

            // --- CHUNKED ROWS (FOR VIRTUAL TABLE) ---
            case 'READ_TABLE_CHUNK': {
                if (!this.activeFile) throw new Error("No file opened");
                const { startRow, endRow } = payload;
                
                const numRowsToRead = (endRow - startRow) + 1;
                const numCols = this.activeFile.getNumCols();
                
                const chunkData: Record<string, any> = {};
                const transferables: ArrayBuffer[] = [];

                for (let i = 1; i <= numCols; i++) {
                    const colInfo = this.activeFile.getColumnInfo(i);
                    if (!colInfo) continue;
                    
                    // Call the WASM method directly for the specific chunk
                    const rawChunkResult = this.activeFile.readColumn(i, startRow, numRowsToRead);
                    
                    if (rawChunkResult && rawChunkResult.data) {
                        chunkData[colInfo.name] = rawChunkResult.data;
                        
                        // 1. Is it a standard flat TypedArray? (Scalar column)
                        if (ArrayBuffer.isView(rawChunkResult.data)) {
                            transferables.push((rawChunkResult.data as any).buffer);
                        } 
                        // 2. Is it a JS Array? (Strings or Vectors)
                        else if (Array.isArray(rawChunkResult.data) && rawChunkResult.data.length > 0) {
                            // If the first element is a TypedArray, it's a Vector/VLA column
                            if (ArrayBuffer.isView(rawChunkResult.data[0])) {
                                // Because of how subarray() works, ALL rows in this column share the EXACT SAME underlying ArrayBuffer!
                                const sharedBuffer = (rawChunkResult.data[0] as any).buffer;
                                if (!transferables.includes(sharedBuffer)) {
                                    transferables.push(sharedBuffer);
                                }
                            }
                            // If it's strings, postMessage handles it normally, no transferables needed
                        }
                    } else {
                        chunkData[colInfo.name] = new Array(numRowsToRead).fill('');
                    }
                }

                return { data: chunkData, transferables };
            }

            case 'WRITE_CELL': {
                if (!this.activeFile) throw new Error("No file opened");
                
                // Extract optional arrayIndex (0-based from React UI)
                const { colNum, rowNum, value, arrayIndex } = payload;
                
                // cfitsio is 1-indexed. If arrayIndex is provided, add 1. Otherwise, default to 1.
                const firstElem = arrayIndex !== undefined ? arrayIndex + 1 : 1;
                
                const status = this.activeFile.writeCell(colNum, rowNum, value, firstElem);
                
                if (status !== 0) throw new Error(`Write failed with status ${status}`);
                return { data: { status } };
            }

            case 'SAVE_FILE': {
                if (!this.activeFile) throw new Error("No file opened");
                
                // activeFile.save() flushes cfitsio buffers and returns a Uint8Array
                const fileBytes = this.activeFile.save();

                return { data: fileBytes, transferables: [fileBytes.buffer as ArrayBuffer] };
            }

            case 'READ_IMAGE': {
                if (!this.activeFile) throw new Error("No file opened");
                
                // Extract optional slice payload
                const { sliceIndices = [] } = payload || {};

                // Check if this is a tile-compressed image
                const zimage = (this.activeFile.readKeyword("ZIMAGE") || "").replace(/'/g, '').trim();
                const isCompressedImage = (zimage === 'T');

                // Determine which keywords to read based on compression
                const kwAxis = isCompressedImage ? "ZNAXIS" : "NAXIS";
                const kwAxis1 = isCompressedImage ? "ZNAXIS1" : "NAXIS1";
                const kwAxis2 = isCompressedImage ? "ZNAXIS2" : "NAXIS2";

                const naxis1 = parseInt(this.activeFile.readKeyword(kwAxis1) || "0", 10);
                const naxis2 = parseInt(this.activeFile.readKeyword(kwAxis2) || "0", 10);
                const naxis = parseInt(this.activeFile.readKeyword(kwAxis) || "0", 10);

                let fpixel = null;
                let lpixel = null;
                let inc = null;

                // If we have a Data Cube (3D, 4D, etc.)
                if (naxis > 2) {
                    fpixel = Array(naxis).fill(1);
                    lpixel = Array(naxis).fill(1);
                    inc = Array(naxis).fill(1);

                    // X and Y bounds (full width and height)
                    lpixel[0] = naxis1;
                    lpixel[1] = naxis2;

                    // Apply slice indices for Z, W, etc.
                    // cfitsio dimensions are 1-indexed (X=0, Y=1, Z=2, etc.)
                    for (let i = 2; i < naxis; i++) {
                        const sliceVal = sliceIndices[i - 2] !== undefined ? sliceIndices[i - 2] : 1;
                        fpixel[i] = sliceVal;
                        lpixel[i] = sliceVal;
                    }
                }

                // Pass the arrays to the wrapper!
                const imageResult = this.activeFile.readImage(fpixel, lpixel, inc);
                if (!imageResult) throw new Error("Current HDU is not an image");
                
                const width = naxis1;
                const height = naxis2;

                // Extract Physical Coordinate Transformation keywords
                const ltv1 = parseFloat(this.activeFile.readKeyword("LTV1") || "0");
                const ltv2 = parseFloat(this.activeFile.readKeyword("LTV2") || "0");
                const ltm1_1 = parseFloat(this.activeFile.readKeyword("LTM1_1") || "1");
                const ltm2_2 = parseFloat(this.activeFile.readKeyword("LTM2_2") || "1");

                const transferables = imageResult.data?.buffer ? [imageResult.data.buffer as ArrayBuffer] : [];

                return { 
                    data: { ...imageResult, width, height, ltv1, ltv2, ltm1_1, ltm2_2 },
                    transferables 
                };
            }

            case 'CHECK_WCS': {
                if (!this.activeFile) throw new Error("No file opened");
                return { data: this.activeFile.hasWCS() };
            }

            case 'PIX_TO_WORLD': {
                if (!this.activeFile) throw new Error("No file opened");
                const { x, y } = payload;
                const coords = this.activeFile.pixToWorld(x, y); // returns {ra, dec} or null
                return { data: coords };
            }

            case 'WORLD_TO_PIX': {
                if (!this.activeFile) throw new Error("No file opened");
                const { ra, dec } = payload;
                const coords = this.activeFile.worldToPix(ra, dec); // returns {x, y} or null
                return { data: coords };
            }

            case 'PIX_SCALE': {
                if (!this.activeFile) throw new Error("No file opened");
                const scale = this.activeFile.getPixelScale();
                return { data: scale };
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }
}