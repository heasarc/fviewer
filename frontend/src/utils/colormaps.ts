// # Copyright 2026, University of Maryland, All Rights Reserved

// Generates a 256-value RGB Lookup Table (LUT)
export function getColormapLUT(name: string): Uint8Array {
    const lut = new Uint8Array(256 * 3);

    for (let i = 0; i < 256; i++) {
        const norm = i / 255;
        let r = 0, g = 0, b = 0;

        switch (name) {
            case 'heat': // Black -> Red -> Yellow -> White (ds9 Heat)
                r = Math.min(1, norm * 3);
                g = Math.min(1, Math.max(0, norm * 3 - 1));
                b = Math.min(1, Math.max(0, norm * 3 - 2));
                break;
                
            case 'cool': // Cyan -> Blue -> Magenta
                r = Math.min(1, Math.max(0, norm * 2 - 1));
                g = Math.min(1, Math.max(0, 1 - norm * 2));
                b = 1;
                break;

            case 'plasma': // Simple procedural approximation of matplotlib Plasma
                r = Math.min(1, norm * 1.5);
                g = Math.sin(norm * Math.PI);
                b = Math.max(0, 1 - norm * 1.5);
                break;

            case 'gray':
            default:
                r = norm; g = norm; b = norm;
                break;
        }

        // Write to LUT
        lut[i * 3] = Math.floor(r * 255);
        lut[i * 3 + 1] = Math.floor(g * 255);
        lut[i * 3 + 2] = Math.floor(b * 255);
    }

    return lut;
}