// Define the extension we accept. Use a base list and their .gz version
const BASE_EXTS = ['.fits', '.fit', '.arf', '.rmf', '.rsp', '.pha'];
export const ALLOWED_EXTS = [...BASE_EXTS, ...BASE_EXTS.map(ext => `${ext}.gz`)];
export const FITS_FORMATS = ALLOWED_EXTS.join(',');