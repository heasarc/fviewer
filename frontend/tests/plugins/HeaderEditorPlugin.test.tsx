// tests/plugins/HeaderEditorPlugin.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { initHeaderEditorPlugin } from '../../src/plugins/HeaderEditorPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('HeaderEditorPlugin', () => {

    afterEach(() => {
        cleanup();
    });
    
    it('should render the Edit Header button in the menubar slot', () => {
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit');
        const button = screen.getByText(/Edit Header/i);
        expect(button).toBeInTheDocument();
    });

    it('should disable the button if no activeHdu is set', () => {
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit', { activeHdu: null });
        const button = screen.getByRole('button', { name: /Edit Header/i });
        expect(button).toBeDisabled();
    });

    it('should open the modal and fetch header when an HDU is active', async () => {
        const mockReadHeader = vi.fn().mockResolvedValue('SIMPLE  = T / file does conform');
        
        renderPluginSlot(initHeaderEditorPlugin, 'menubar:edit', {
            activeHdu: 1,
            fitsWorker: { readHeader: mockReadHeader } as any
        });
        
        await waitFor(() => {
            expect(mockReadHeader).toHaveBeenCalled();
        });

        const button = screen.getByText(/Edit Header/i);
        fireEvent.click(button);

        // Verify the parsed Keyword and Comment appear in the grid!
        const keywordCell = await screen.findByText('SIMPLE');
        const commentCell = await screen.findByText('file does conform');
        
        expect(keywordCell).toBeInTheDocument();
        expect(commentCell).toBeInTheDocument();
    });
});