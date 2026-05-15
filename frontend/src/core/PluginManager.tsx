// src/core/PluginManager.tsx
import React from 'react';

type SlotRegistry = Map<string, React.ReactNode[]>;

class PluginManager {
    private slots: SlotRegistry = new Map();

    // Plugins use this to push UI components into specific areas of the app
    registerUI(slotName: string, component: React.ReactNode) {
        const current = this.slots.get(slotName) || [];
        this.slots.set(slotName, [...current, component]);
    }

    // The core app uses this to fetch components for a specific area
    getComponents(slotName: string): React.ReactNode[] {
        return this.slots.get(slotName) || [];
    }
}

// Export a single instance
export const pluginManager = new PluginManager();

// --- The React Component to drop into App.tsx ---
export const ExtensionSlot = ({ name }: { name: string }) => {
    const components = pluginManager.getComponents(name);
    
    if (components.length === 0) return null;

    return (
        <>
            {components.map((Comp, index) => (
                <React.Fragment key={`${name}-${index}`}>
                    {Comp}
                </React.Fragment>
            ))}
        </>
    );
};