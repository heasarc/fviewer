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

            // We will add READ_IMAGE, READ_COLUMN, WRITE_CELL, etc. here later

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error) {
        self.postMessage({ id, success: false, error: (error as Error).message });
    }
};