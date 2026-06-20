// # Copyright 2026, University of Maryland, All Rights Reserved

// Maps a normalized value [0.0 - 1.0] through a non-linear stretch function
export function applyStretch(norm: number, stretch: string): number {
    // Clamp to [0, 1] to prevent math errors
    const v = Math.max(0, Math.min(1, norm));

    switch (stretch) {
        case 'log':
            // Logarithmic: Enhances faint details (a=1000 is standard ds9)
            return Math.log10(v * 1000 + 1) / 3.000434; 
        case 'square root':
            // Square Root: Good balance between linear and log
            return Math.sqrt(v);
        case 'asinh':
            // Inverse Hyperbolic Sine: Excellent for stars + galaxies
            return Math.asinh(v * 10) / 2.99822; 
        case 'linear':
        default:
            return v;
    }
}