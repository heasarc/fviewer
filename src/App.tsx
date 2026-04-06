import React, { useState } from 'react';
import { useFits } from './hooks/useFits';

function App() {
    const { openFile, readHeader } = useFits();
    const [headerText, setHeaderText] = useState<string>('');

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const buffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        try {
            console.log("Sending to worker...");
            const { numHDUs } = await openFile(uint8Array);
            console.log(`File opened! It has ${numHDUs} HDUs.`);

            const header = await readHeader();
            setHeaderText(header);
        } catch (error) {
            console.error("Failed to load FITS:", error);
        }
    };

    return (
        <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>FViewer</h1>
            <input type="file" accept=".fits,.fit,.fts" onChange={handleFileUpload} />
            
            {headerText && (
                <pre style={{ background: '#f4f4f4', padding: '10px', marginTop: '20px' }}>
                    {headerText}
                </pre>
            )}
        </div>
    );
}

export default App;