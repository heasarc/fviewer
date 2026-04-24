import { useCallback } from 'react';

export function useCommandHandler(
    processFile: (file: File) => void,
    setColormap: (cmap: string) => void,
    setStretch: (cmap: string) => void
) {
  return useCallback(async (command: any) => {
    console.log("Received remote command:", command);
    
    switch (command.action) {
      case 'load_file':
        try {
          const response = await fetch(`/api/file?path=${encodeURIComponent(command.path)}`);
          if (!response.ok) throw new Error("Failed to fetch file");
          
          const blob = await response.blob();
          const filename = command.path.split('/').pop() || 'remote.fits';
          
          // Create the File object and pass it to your app's logic
          const file = new File([blob], filename, { type: 'application/octet-stream' });
          processFile(file);
          
        } catch (error) {
          console.error("Error loading remote file:", error);
        }
        break;
    
    case 'set_colormap':
        // Apply the new colormap from Python!
        if (command.cmap) {
            setColormap(command.cmap);
        }
        break;

    case 'set_stretch':
        // Apply the new colormap from Python!
        if (command.stretch) {
            setStretch(command.stretch);
        }
        break;
    
      default:
        console.warn("Unknown command:", command.action);
    }
  }, [processFile]);
}