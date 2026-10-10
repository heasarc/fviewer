import { describe, it, expect } from 'vitest';
import { ALLOWED_EXTS, FITS_FORMATS } from '../../src/utils/constants';

describe('constants', () => {
    it('includes gz variants and a joined accept string', () => {
        expect(ALLOWED_EXTS).toContain('.fits');
        expect(ALLOWED_EXTS).toContain('.fits.gz');
        expect(FITS_FORMATS.split(',')).toEqual(ALLOWED_EXTS);
    });
});
