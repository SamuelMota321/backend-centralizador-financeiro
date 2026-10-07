import type { ParsedOfxStatement } from '../../domain/ofx-statement.js';

export const OFX_PARSER = Symbol('OFX_PARSER');

export interface OfxParser {
  parse(content: Uint8Array): ParsedOfxStatement;
}
