import { FitsFile } from 'wasm-cfitsio'; // Adjust import path as needed

// Store the active file in the worker's memory
let activeFile: FitsFile | null = null;

// Listen for messages from the main React thread
self.onmessage = async (e: MessageEvent) => {
    const { id, action, payload } = e.data;

    try {
        switch (action) {
            case 'OPEN_FILE': {
                // payload is the raw Uint8Array from the file input
                if (activeFile) activeFile.close(); // Clean up old file
                activeFile = await FitsFile.open(payload);
                
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

            case 'READ_COLUMN': {
                if (!activeFile) throw new Error("No file opened");
                // payload.colNum is 1-indexed
                const colData = activeFile.readColumn(payload.colNum);
                
                // Transfer the TypedArray to the main thread efficiently
                self.postMessage({ id, success: true, data: colData });
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

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        self.postMessage({ id, success: false, error: (error as Error).message });
    }
};