// The votable-wasm package ships without type declarations.
declare module 'votable-wasm' {
    export default function init(options?: { module_or_path?: string | URL | Request | BufferSource }): Promise<unknown>;
    export function fromXML(xml: string): any;
}
