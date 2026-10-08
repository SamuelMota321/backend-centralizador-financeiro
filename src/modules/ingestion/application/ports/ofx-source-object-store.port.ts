export const OFX_SOURCE_OBJECT_STORE = Symbol('OFX_SOURCE_OBJECT_STORE');

export interface OfxSourceObjectStore {
  put(key: string, content: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}
