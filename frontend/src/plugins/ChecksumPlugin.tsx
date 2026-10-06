import { pluginManager } from '../core/PluginManager';
import { ChecksumVerification } from '../components/ChecksumVerification';

export function initChecksumPlugin() {
    pluginManager.registerUI('menubar:file', <ChecksumVerification />);
}
