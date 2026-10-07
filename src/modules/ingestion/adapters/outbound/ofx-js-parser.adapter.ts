import { Injectable } from '@nestjs/common';
import { parseStrict } from 'ofx-js';
import { InvalidOfxFile } from '../../domain/ingestion.errors.js';
import type {
  OfxVariant,
  ParsedOfxStatement,
  ParsedOfxTransaction,
} from '../../domain/ofx-statement.js';
import type { OfxParser } from '../../application/ports/ofx-parser.port.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CENTS = 9_999_999_999_999_999_999n;
const ALLOWED_TRANSACTION_TYPES = new Set([
  'CREDIT',
  'DEBIT',
  'INT',
  'DIV',
  'FEE',
  'SRVCHG',
  'DEP',
  'ATM',
  'POS',
  'XFER',
  'CHECK',
  'PAYMENT',
  'CASH',
  'DIRECTDEP',
  'DIRECTDEBIT',
  'REPEATPMT',
  'HOLD',
  'OTHER',
]);

@Injectable()
export class OfxJsParserAdapter implements OfxParser {
  parse(content: Uint8Array): ParsedOfxStatement {
    if (content.byteLength === 0 || content.byteLength > MAX_FILE_BYTES) {
      throw new InvalidOfxFile('OFX file size is outside the approved limit.');
    }
    if (hasPdfSignature(content)) {
      throw new InvalidOfxFile('PDF content is not supported.');
    }

    const text = decodeSupportedText(content);
    const rootOffset = text.indexOf('<OFX>');
    if (rootOffset < 0 || text.indexOf('<OFX>', rootOffset + 1) >= 0) {
      throw new InvalidOfxFile('OFX document root is missing or ambiguous.');
    }
    const variant = detectVariant(text.slice(0, rootOffset));
    validateEncodingDeclaration(text.slice(0, rootOffset), content);

    let parsed: unknown;
    try {
      parsed = parseStrict(text);
    } catch {
      throw new InvalidOfxFile('OFX document structure is invalid.');
    }

    const document = recordAt(parsed, 'OFX');
    if (!document)
      throw new InvalidOfxFile('OFX document structure is invalid.');
    const unsupportedSection = Object.keys(document).some(
      (key) =>
        !['SIGNONMSGSRSV1', 'BANKMSGSRSV1', 'CREDITCARDMSGSRSV1'].includes(key),
    );
    if (unsupportedSection) {
      throw new InvalidOfxFile(
        'OFX document contains an unsupported message set.',
      );
    }
    const entries = findSingleStatement(document);

    return {
      variant,
      transactions: entries.map((entry, index) =>
        parseTransaction(entry, index + 1),
      ),
    };
  }
}

function decodeSupportedText(content: Uint8Array): string {
  if (content.includes(0)) {
    throw new InvalidOfxFile('Binary content is not supported.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(content)
      .replace(/^\uFEFF/u, '');
  } catch {
    throw new InvalidOfxFile('Only ASCII and UTF-8 OFX content is supported.');
  }
}

function detectVariant(header: string): OfxVariant {
  const ofxHeader = header.match(/\bOFXHEADER\s*[:=]\s*["']?(\d+)/iu)?.[1];
  const versions = [...header.matchAll(/\bVERSION\s*[:=]\s*["']?(\d+)/giu)];
  const version = versions.at(-1)?.[1];
  const data = header.match(/\bDATA\s*[:=]\s*["']?([A-Z]+)/iu)?.[1];

  if (ofxHeader === '100' && version?.startsWith('1') && data === 'OFXSGML') {
    return 'ofx_1_sgml';
  }
  if (
    ofxHeader === '200' &&
    version?.startsWith('2') &&
    (data === 'OFXXML' || /<\?xml\s/iu.test(header))
  ) {
    return 'ofx_2_xml';
  }
  throw new InvalidOfxFile('OFX version or encoding variant is not supported.');
}

function validateEncodingDeclaration(
  header: string,
  content: Uint8Array,
): void {
  const encoding = header.match(
    /\bENCODING\s*[:=]\s*["']?([A-Z0-9_-]+)/iu,
  )?.[1];
  const charset = header.match(/\bCHARSET\s*[:=]\s*["']?([A-Z0-9_-]+)/iu)?.[1];
  const xmlEncoding = header.match(/\bencoding\s*=\s*["']([^"']+)["']/iu)?.[1];
  const declarations = [encoding, charset, xmlEncoding]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.toUpperCase().replaceAll('_', '-'));
  if (
    declarations.some((value) => !['ASCII', 'USASCII', 'UTF-8'].includes(value))
  ) {
    throw new InvalidOfxFile('Only ASCII and UTF-8 OFX content is supported.');
  }
  if (
    declarations.some((value) => value === 'ASCII' || value === 'USASCII') &&
    content.some((byte) => byte > 0x7f)
  ) {
    throw new InvalidOfxFile('ASCII OFX content contains non-ASCII bytes.');
  }
}

function findSingleStatement(document: Record<string, unknown>): unknown[] {
  const responses: Array<
    Readonly<{
      value: unknown;
      statementKey: 'STMTRS' | 'CCSTMTRS';
      transactionTag: 'STMTTRN' | 'CCSTMTTRN';
    }>
  > = [];
  const bankGroup = recordAt(document, 'BANKMSGSRSV1');
  for (const response of bankGroup ? asArray(bankGroup.STMTTRNRS) : []) {
    responses.push({
      value: response,
      statementKey: 'STMTRS',
      transactionTag: 'STMTTRN',
    });
  }
  const cardGroup = recordAt(document, 'CREDITCARDMSGSRSV1');
  for (const response of cardGroup ? asArray(cardGroup.CCSTMTTRNRS) : []) {
    responses.push({
      value: response,
      statementKey: 'CCSTMTRS',
      transactionTag: 'CCSTMTTRN',
    });
  }
  if (responses.length !== 1) {
    throw new InvalidOfxFile(
      'Exactly one bank or credit-card statement is required.',
    );
  }
  const response = responses[0];
  const statement = response
    ? recordAt(response.value, response.statementKey)
    : null;
  if (!response || !statement) {
    throw new InvalidOfxFile('Statement response structure is invalid.');
  }
  if (statement.BANKTRANLISTP !== undefined) {
    throw new InvalidOfxFile(
      'Pending statement transactions are not supported.',
    );
  }
  const transactionList = recordAt(statement, 'BANKTRANLIST');
  if (!transactionList) return [];
  if (response.transactionTag === 'CCSTMTTRN') {
    const creditCardItems = transactionList.CCSTMTTRN;
    const standardItems = transactionList.STMTTRN;
    if (creditCardItems !== undefined && standardItems !== undefined) {
      throw new InvalidOfxFile(
        'Credit-card statement transaction list is ambiguous.',
      );
    }
    return asArray(creditCardItems ?? standardItems);
  }
  return asArray(transactionList.STMTTRN);
}

function parseTransaction(
  value: unknown,
  ordinal: number,
): ParsedOfxTransaction {
  const transaction = asRecord(value);
  if (!transaction)
    throw new InvalidOfxFile('Statement transaction is invalid.');

  const rawType = requiredString(
    transaction.TRNTYPE,
    'transaction type',
  ).toUpperCase();
  if (!ALLOWED_TRANSACTION_TYPES.has(rawType)) {
    throw new InvalidOfxFile(
      'Statement contains an unsupported transaction type.',
    );
  }
  const occurredOn = parsePostedDate(
    requiredString(transaction.DTPOSTED, 'posting date'),
  );
  const parsedAmount = parseAmount(
    requiredString(transaction.TRNAMT, 'transaction amount'),
  );
  const normalizedExternalId =
    optionalString(transaction.FITID)?.trim() ||
    optionalString(transaction.ID)?.trim() ||
    '';
  if (normalizedExternalId.length > 255) {
    throw new InvalidOfxFile(
      'External transaction ID exceeds the supported size.',
    );
  }
  const description =
    optionalString(transaction.NAME)?.trim() ||
    optionalString(transaction.MEMO)?.trim() ||
    null;

  return {
    ordinal,
    externalId: normalizedExternalId || null,
    type: parsedAmount.negative ? 'expense' : 'income',
    amount: parsedAmount.amount,
    occurredOn,
    description,
    warnings: normalizedExternalId ? [] : ['external_id_missing'],
  };
}

function parsePostedDate(value: string): string {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:(?:\d{2}){3}(?:\.\d+)?(?:\[[^\]\r\n]+\])?|\[[^\]\r\n]+\])?$/u,
  );
  if (!match) throw new InvalidOfxFile('Statement posting date is invalid.');
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new InvalidOfxFile('Statement posting date is invalid.');
  }
  return date;
}

function parseAmount(
  value: string,
): Readonly<{ amount: string; negative: boolean }> {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/u);
  if (!match) throw new InvalidOfxFile('Statement amount is invalid.');
  const integer = (match[2] ?? '').replace(/^0+(?=\d)/u, '');
  if (integer.length > 17) {
    throw new InvalidOfxFile(
      'Statement amount is outside the supported range.',
    );
  }
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = BigInt(integer) * 100n + BigInt(fraction);
  if (cents === 0n || cents > MAX_CENTS) {
    throw new InvalidOfxFile(
      'Statement amount is zero or outside the supported range.',
    );
  }
  return {
    amount: `${integer}.${fraction}`,
    negative: match[1] === '-',
  };
}

function requiredString(value: unknown, field: string): string {
  const stringValue = optionalString(value);
  if (!stringValue) throw new InvalidOfxFile(`Statement ${field} is missing.`);
  return stringValue;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new InvalidOfxFile('Statement field has an invalid value.');
  }
  return value;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasPdfSignature(content: Uint8Array): boolean {
  let offset = 0;
  while (
    offset < Math.min(content.length, 32) &&
    [0x09, 0x0a, 0x0d, 0x20].includes(content[offset] ?? 0)
  ) {
    offset += 1;
  }
  return (
    content[offset] === 0x25 &&
    content[offset + 1] === 0x50 &&
    content[offset + 2] === 0x44 &&
    content[offset + 3] === 0x46 &&
    content[offset + 4] === 0x2d
  );
}
