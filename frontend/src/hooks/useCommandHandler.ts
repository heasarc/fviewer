import { useCallback } from 'react';

export function useCommandHandler(
    processFile: (file: File) => void,
    colormap: string,
    setColormap: (cmap: string) => void,
    stretch: string,
    setStretch: (cmap: string) => void,
) {
  return useCallback(async (command: any, sendReply: (msg: any) => void) => {
    console.log("Received remote command:", command);

    // Helper to send a simple OK
    const ack = () => sendReply({ message_id: command.message_id, status: 'ok' });

    // Helper to send data
    const replyData = (data: any) => sendReply({ message_id: command.message_id, ...data });
    
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
          ack();
          
        } catch (error) {
          console.error("Error loading remote file:", error);
        }
        break;
    
    case 'set_colormap':
        if (command.cmap) setColormap(command.cmap);
        ack();
        break;

    case 'get_colormap':
        replyData({ colormap });
        break;

    case 'set_stretch':
        if (command.stretch) setStretch(command.stretch);
        ack();
        break;

    case 'get_stretch':
        replyData({ stretch });
        break;
    
      default:
        sendReply({ message_id: command.message_id, error: `Unknown command: ${command.action}` });
    }
  }, [processFile, colormap, setColormap, stretch, setStretch]);
}