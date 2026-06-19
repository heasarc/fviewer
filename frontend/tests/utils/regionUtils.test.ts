// # Copyright 2026, University of Maryland, All Rights Reserved

import { describe, it, expect, vi } from 'vitest';
import { parseDS9Regions, serializeDS9Regions, type Region, type PhysicalTransform } from '../../src/utils/regionUtils';
import type { PixelScale } from 'wasm-cfitsio';

describe('regionUtils', () => {
    const width = 1000;
    const height = 1000;
    
    // Mocks for WCS coordinate conversions
    const mockWorldToPix = vi.fn().mockImplementation(async (ra: number, dec: number) => {
        return { x: ra * 10, y: dec * 10 };
    });
    
    const mockPixToWorld = vi.fn().mockImplementation(async (x: number, y: number) => {
        return { ra: x / 10, dec: y / 10 };
    });

    const mockPixelScale: PixelScale = { scaleX: 0.1, scaleY: 0.1, unitX: 'deg', unitY: 'deg' };

    describe('parseDS9Regions', () => {
        it('should ignore empty lines, comments, and global definitions', async () => {
            const ds9 = `
                # This is a comment
                global color=green
                
                circle(10, 10, 5)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            expect(regions).toHaveLength(1);
        });

        it('should parse simple image coordinates for all shapes', async () => {
            const ds9 = `
                image
                circle(100, 200, 50)
                box(300, 400, 60, 80, 45)
                ellipse(500, 600, 30, 40, 15)
                annulus(700, 800, 10, 20)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            expect(regions).toHaveLength(4);
            
            // Note: CY is inverted (height - cy)
            // Circle
            expect(regions[0].type).toBe('circle');
            expect(regions[0].startX).toBe(100);
            expect(regions[0].startY).toBe(800); // 1000 - 200
            expect(regions[0].endX).toBe(150);   // cx + r (100 + 50)

            // Box
            expect(regions[1].type).toBe('box');
            expect(regions[1].startX).toBe(270); // 300 - 60/2
            expect(regions[1].startY).toBe(560); // 1000 - 400 - 80/2
            expect(regions[1].angle).toBe(-45);

            // Ellipse
            expect(regions[2].type).toBe('ellipse');
            expect(regions[2].endX).toBe(530);   // cx + rx (500 + 30)
            expect(regions[2].angle).toBe(-15);

            // Annulus
            expect(regions[3].type).toBe('annulus');
            expect(regions[3].innerR).toBe(10);
            expect(regions[3].endX).toBe(720);   // cx + r (700 + 20)
        });

        it('should correctly parse region properties (color, background)', async () => {
            const ds9 = `
                circle(10, 10, 5) # color=red
                circle(20, 20, 5) # background color=#00ff00
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            expect(regions[0].color).toBe('red');
            expect(regions[0].isBackground).toBe(false);
            expect(regions[1].color).toBe('#00ff00');
            expect(regions[1].isBackground).toBe(true);
        });

        it('should correctly parse argument unit suffixes', async () => {
            const ds9 = `
                image
                circle(100, 100, 3600") # arcsec to deg
                circle(100, 100, 60')   # arcmin to deg
                circle(100, 100, 2d)    # degrees
                circle(100, 100, 3.14159r) # radians to deg
                circle(100, 100, 50p)   # pixels
                circle(100, 100, 50i)   # pixels (i)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            expect(regions[0].endX).toBeCloseTo(101); // 3600 arcsec = 1 deg
            expect(regions[1].endX).toBeCloseTo(101); // 60 arcmin = 1 deg
            expect(regions[2].endX).toBeCloseTo(102); 
            expect(regions[3].endX).toBeCloseTo(280, -1); // PI radians ~ 180
            expect(regions[4].endX).toBeCloseTo(150);
            expect(regions[5].endX).toBeCloseTo(150);
        });

        it('should correctly parse sexagesimal and colon coordinate strings', async () => {
            const ds9 = `
                fk5
                # Sexagesimal RA / Dec
                circle(12h30m30s, 45d30m30s, 1)
                # Negative Sexagesimal
                circle(-12h30m30s, -45d30m30s, 1)
                # Colon formatted RA / Dec
                circle(12:30:30, 45:30:30, 1)
                # Negative Colon
                circle(-12:30:30, -45:30:30, 1)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            
            // Expected values:
            // RA: (12 + 30/60 + 30/3600) * 15 = 187.625
            // Dec: 45 + 30/60 + 30/3600 = 45.508333
            
            expect(regions).toHaveLength(4);
            expect(mockWorldToPix).toHaveBeenCalledWith(187.625, 45.50833333333333);
            expect(mockWorldToPix).toHaveBeenCalledWith(-187.625, -45.50833333333333);
        });

        it('should handle physical coordinate transforms', async () => {
            const physTransform: PhysicalTransform = { ltv1: 10, ltv2: 20, ltm1_1: 2, ltm2_2: 2 };
            const ds9 = `
                physical
                circle(100, 100, 50)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix, physTransform);
            
            // cx = (2 * 100) + 10 = 210
            // cy = (2 * 100) + 20 = 220. Reverted: 1000 - 220 = 780
            // radius = 50 * 2 = 100.
            expect(regions[0].startX).toBe(210);
            expect(regions[0].startY).toBe(780);
            expect(regions[0].endX).toBe(310);
        });

        it('should handle WCS coordinate mapping and worldToPix shapes', async () => {
            const ds9 = `
                fk5
                circle(10, 10, 5)
                box(10, 10, 2, 4, 0)
                annulus(10, 10, 2, 5)
            `;
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
            
            expect(regions).toHaveLength(3);
            expect(mockWorldToPix).toHaveBeenCalled();
        });

        it('should skip unparseable lines and null WCS resolutions', async () => {
            const ds9 = `
                circle(NaN, NaN, 5)
                junkdata
                fk5
                circle(999, 999, 5) # where 999 returns null from worldToPix
            `;
            const failingWorldToPix = vi.fn().mockResolvedValue(null);
            const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, failingWorldToPix);
            
            expect(regions).toHaveLength(0); // All should be skipped safely
        });

        it('should fallback parsing of dirty text numbers', async () => {
             const ds9 = `image\ncircle(10a, 20b, 5)`;
             const regions = await parseDS9Regions(ds9, width, height, mockPixToWorld, mockWorldToPix);
             expect(regions[0].startX).toBe(10);
             expect(regions[0].endX).toBe(15);
        });
    });

    describe('serializeDS9Regions', () => {
        const regions: Region[] = [
            { id: '1', type: 'circle', startX: 100, startY: 800, endX: 150, endY: 800, color: 'red', isBackground: false },
            { id: '2', type: 'box', startX: 270, startY: 560, endX: 330, endY: 640, color: 'blue', angle: -45 },
            { id: '3', type: 'ellipse', startX: 500, startY: 400, endX: 530, endY: 440, color: 'green', angle: 0 },
            { id: '4', type: 'annulus', startX: 700, startY: 200, endX: 720, endY: 200, innerR: 10, color: 'white', isBackground: true }
        ];

        it('should serialize to image format by default', async () => {
            const ds9 = await serializeDS9Regions(regions, 'image', width, height, mockPixToWorld, mockPixelScale);
            
            expect(ds9).toContain('image\n');
            expect(ds9).toContain('circle(100.00000,200.00000,50.00000)'); // Y reversed back
            expect(ds9).toContain('box(300.00000,400.00000,60.00000,80.00000,45.000'); // Angle inverted
            expect(ds9).toContain('ellipse(500.00000,600.00000,30.00000,40.00000,0.000');
            expect(ds9).toContain('annulus(700.00000,800.00000,10.00000,20.00000)');
            expect(ds9).toContain('background');
        });

        it('should serialize to physical format with transforms', async () => {
            const physTransform: PhysicalTransform = { ltv1: 10, ltv2: 20, ltm1_1: 2, ltm2_2: 2 };
            const ds9 = await serializeDS9Regions(regions, 'physical', width, height, mockPixToWorld, mockPixelScale, physTransform);
            
            expect(ds9).toContain('physical\n');
            // circle cx = (100 - 10) / 2 = 45. cy = (200 - 20) / 2 = 90.
            expect(ds9).toContain('circle(45.00000,90.00000,25.00000)');
        });

        it('should serialize to fk5 format using Haversine calculation', async () => {
            const ds9 = await serializeDS9Regions(regions, 'fk5', width, height, mockPixToWorld, mockPixelScale);
            
            expect(ds9).toContain('fk5\n');
            expect(mockPixToWorld).toHaveBeenCalled();
            // With mock returning ra: x/10, dec: y/10
            expect(ds9).toContain('circle('); 
        });

        it('should fallback to image format if fk5 requested but pixelScale is missing', async () => {
            const ds9 = await serializeDS9Regions(regions, 'fk5', width, height, mockPixToWorld, null);
            expect(ds9).toContain('image\n'); // Fallback triggered
        });

        it('should handle null WCS returns gracefully during haversine distance calculation', async () => {
            const failingPixToWorld = vi.fn().mockResolvedValue(null);
            const ds9 = await serializeDS9Regions(regions, 'fk5', width, height, failingPixToWorld, mockPixelScale);
            
            expect(ds9).toContain('circle('); 
            // Expect distance calculation to have defaulted to 0
        });
    });
});