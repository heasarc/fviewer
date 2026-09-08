---
name: add-plugin
description: Scaffold a new FViewer React frontend plugin — component, command handlers, extension slot registration, and test file
---

# Add Plugin Skill

Step-by-step guide to add a new frontend plugin to FViewer. A plugin is a self-contained React component that registers into the app's extension slot system and optionally exposes WebSocket commands via the CommandRegistry.

## Architecture Overview

```
main.tsx          →  calls initMyPlugin()  (before React renders)
  ↓
PluginManager     →  registerUI('slot:name', <MyPluginComponent />)
  ↓
ExtensionSlot     →  renders the component wherever <ExtensionSlot name="slot:name" /> appears
  ↓
CommandRegistry   →  (optional) registers WebSocket command handlers inside useEffect
```

## Step 1: Create the Plugin File

Create `frontend/src/plugins/MyPlugin.tsx` following the three-part contract:

```tsx
import { useEffect } from 'react';
import { useCore } from '../core/FViewerContext';
import { pluginManager } from '../core/PluginManager';
import { commandRegistry } from '../core/CommandRegistry';

const MyPluginComponent = () => {
    const { /* destructure needed state/setters from context */ } = useCore();

    // --- Part A: Command Registration (optional) ---
    useEffect(() => {
        const ack = (cmd: any, sendReply: any) =>
            sendReply({ message_id: cmd.message_id, status: 'ok' });

        commandRegistry.register('my_action', async (command, sendReply) => {
            // handle command, update state via setters
            ack(command, sendReply);
        });

        return () => {
            commandRegistry.unregister('my_action');
        };
    }, [/* include state values and setters used by handlers */]);

    // --- Part B: Render UI ---
    return (
        <div>
            {/* Plugin UI here */}
        </div>
    );
};

// --- Part C: Init function (registers into slot) ---
export function initMyPlugin() {
    pluginManager.registerUI('target:slot', <MyPluginComponent />);
}
```

### Naming Conventions

| Item | Convention | Example |
|---|---|---|
| File | `PascalCasePlugin.tsx` | `MyPlugin.tsx` |
| Internal component | `const MyPluginComponent = () => { ... }` | Not exported |
| Init function | `export function initMyPlugin()` | `init` + plugin name |
| Commands | `snake_case` strings | `set_colormap`, `get_stretch` |

### Key Rules

- The internal component is **not exported** — only the init function is
- Commands are registered **inside the component's `useEffect`**, not in the init function, so they close over live React state
- Always **unregister commands** in the useEffect cleanup return
- The `useEffect` dependency array must include all state values and setters used by the handlers
- Use `useCore()` to access `FViewerContext` state — never import the context directly in plugins

## Step 2: Register in main.tsx

Edit `frontend/src/main.tsx`:

1. Add the import with the other plugin imports:
```tsx
import { initMyPlugin } from './plugins/MyPlugin';
```

2. Add the init call alongside the other plugins (before `createRoot`):
```tsx
initMyPlugin();
```

The order of init calls determines rendering order within a shared slot.

## Step 3: Create the Test File

Create `frontend/tests/plugins/MyPlugin.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { initMyPlugin } from '../../src/plugins/MyPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

describe('MyPlugin', () => {
    afterEach(() => { cleanup(); });

    // Test 1: Renders in the correct slot
    it('should render the plugin UI', () => {
        renderPluginSlot(initMyPlugin, 'target:slot');
        expect(screen.getByTitle('My Button Title')).toBeInTheDocument();
    });

    // Test 2: State interaction via mock setters
    it('should call setter on user action', () => {
        const mockSetFoo = vi.fn();
        renderPluginSlot(initMyPlugin, 'target:slot', { setFoo: mockSetFoo });
        
        fireEvent.click(screen.getByText('Click Me'));
        expect(mockSetFoo).toHaveBeenCalledWith('expected_value');
    });

    // Test 3: WebSocket command handling (if plugin registers commands)
    it('should handle my_action command', async () => {
        const mockSetFoo = vi.fn();
        const { executeCommand } = renderPluginSlot(initMyPlugin, 'target:slot', {
            setFoo: mockSetFoo,
        });

        const mockSendReply = vi.fn();
        await executeCommand(
            { action: 'my_action', value: 'bar', message_id: '123' },
            mockSendReply
        );

        expect(mockSetFoo).toHaveBeenCalledWith('bar');
        expect(mockSendReply).toHaveBeenCalledWith({
            message_id: '123',
            status: 'ok',
        });
    });
});
```

### Test Patterns

- `renderPluginSlot(initFn, slotName, contextOverrides)` handles clearing registries, calling `initFn`, creating a mock context, and rendering the slot
- Pass mock setters via the third argument (`contextOverrides`) to assert state changes
- Use the returned `executeCommand(cmd, sendReplyMock)` to test WebSocket command handlers
- Always call `cleanup()` in `afterEach` to prevent test pollution

## Step 4: Run the Tests

```bash
cd frontend
npx vitest run tests/plugins/MyPlugin.test.tsx
```

## Available Extension Slots

Choose the slot that matches where the plugin's UI should appear:

### App-level slots (rendered in `App.tsx`)

| Slot Name | Location | Current Occupants |
|---|---|---|
| `menubar:left` | Left side of top navbar | HDUExplorerPlugin |
| `menubar:file` | Inside File dropdown menu | ServerFilePlugin |
| `menubar:edit` | Inside Edit dropdown menu | HeaderEditorPlugin |
| `menubar:view` | Inside View dropdown menu | *(empty)* |
| `menubar:menus` | New top-level menu items | TAPQueryPlugin |
| `menubar:mobile` | Mobile-only navbar items | HDUExplorerPlugin |
| `menubar:right` | Right side of navbar | PlotterPlugin |
| `workspace:left` | Left sidebar panel | HDUExplorerPlugin |
| `workspace:right` | Right sidebar panel | PlotterPlugin |

### Image toolbar slots (rendered in `FitsImage.tsx`)

| Slot Name | Location | Current Occupants |
|---|---|---|
| `fitsimage:toolbar:left` | Left side of image toolbar | RegionToolbarPlugin |
| `fitsimage:toolbar` | Center of image toolbar | ImageControlPlugin, TransformPlugin, DataCubePlugin |
| `fitsimage:toolbar:right` | Right side of image toolbar | ZoomPlugin |

Multiple plugins can share the same slot — they render in init-call order.

## Step 5: Add New State to Context (if needed)

If your plugin needs new shared state that doesn't exist in `FViewerContext`:

1. Add the state and setter to `frontend/src/core/FViewerContext.tsx`:
   - Add to the `CoreContextType` interface
   - Add `useState` in `FViewerProvider`
   - Add to the context value object

2. Update the mock in `frontend/tests/utils/PluginTestWrapper.tsx`:
   - Add the new state key and a `vi.fn()` setter to `createMockContext`

## Checklist

- [ ] Plugin file created in `frontend/src/plugins/NamePlugin.tsx`
- [ ] Internal component uses `useCore()` for state access
- [ ] Commands registered in `useEffect` with cleanup (if applicable)
- [ ] `export function initNamePlugin()` calls `pluginManager.registerUI()`
- [ ] Import and init call added to `frontend/src/main.tsx`
- [ ] Test file created in `frontend/tests/plugins/NamePlugin.test.tsx`
- [ ] Tests cover: rendering, user interactions, and command handling
- [ ] `npx vitest run tests/plugins/NamePlugin.test.tsx` passes
- [ ] New context state added (if needed) in `FViewerContext.tsx` and `PluginTestWrapper.tsx`
