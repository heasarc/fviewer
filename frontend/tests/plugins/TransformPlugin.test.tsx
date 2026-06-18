import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initTransformPlugin } from '../../src/plugins/TransformPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('TransformPlugin', () => {
    afterEach(() => { cleanup(); });

    it('should render the Transform dropdown', () => {
        renderPluginSlot(initTransformPlugin, 'fitsimage:toolbar');
        expect(screen.getByText(/Transform/i)).toBeInTheDocument();
    });

    it('should toggle Flip X when clicked', () => {
        const mockSetFlipX = vi.fn();
        renderPluginSlot(initTransformPlugin, 'fitsimage:toolbar', {
            flipX: false, // current state
            setFlipX: mockSetFlipX
        });

        fireEvent.click(screen.getByText(/Flip X/i));
        // It should call the setter with the opposite of current state (true)
        expect(mockSetFlipX).toHaveBeenCalledWith(true);
    });

    it('should allow custom angle input', () => {
        const mockSetRotation = vi.fn();
        renderPluginSlot(initTransformPlugin, 'fitsimage:toolbar', {
            rotation: 0,
            setRotation: mockSetRotation
        });

        const input = screen.getByDisplayValue('0');
        fireEvent.change(input, { target: { value: '45' } });
        
        expect(mockSetRotation).toHaveBeenCalledWith(45);
    });
});