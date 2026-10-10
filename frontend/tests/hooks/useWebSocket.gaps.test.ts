import { describe, it, expect } from 'vitest';
import { getBasePath, getApiUrl } from '../../src/hooks/useWebSocket';

describe('useWebSocket url helpers gaps', () => {
    it('getBasePath adds a trailing slash when the pathname lacks one', () => {
        const orig = window.location.pathname;
        window.history.replaceState({}, '', '/fviewer');
        try {
            expect(getBasePath()).toBe('/fviewer/');
            expect(getApiUrl('api/x')).toBe('/fviewer/api/x');
        } finally {
            window.history.replaceState({}, '', orig);
        }
    });

    it('getBasePath keeps an existing trailing slash', () => {
        const orig = window.location.pathname;
        window.history.replaceState({}, '', '/fviewer/');
        try {
            expect(getBasePath()).toBe('/fviewer/');
        } finally {
            window.history.replaceState({}, '', orig);
        }
    });
});
