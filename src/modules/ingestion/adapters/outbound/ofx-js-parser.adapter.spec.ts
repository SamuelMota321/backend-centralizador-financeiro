import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvalidOfxFile } from '../../domain/ingestion.errors.js';
import { OfxJsParserAdapter } from './ofx-js-parser.adapter.js';

const parser = new OfxJsParserAdapter();
const bankFixture = readFileSync(
  new URL(
    '../../../../../test/fixtures/ofx/ofx-1-bank-ascii.ofx',
    import.meta.url,
  ),
);
const cardFixture = readFileSync(
  new URL(
    '../../../../../test/fixtures/ofx/ofx-2-credit-card-utf8.ofx',
    import.meta.url,
  ),
);

describe('OfxJsParserAdapter', () => {
  it('normalizes an OFX 1.x ASCII bank statement and signed debit amount', () => {
    expect(parser.parse(bankFixture)).toEqual({
      variant: 'ofx_1_sgml',
      transactions: [
        {
          ordinal: 1,
          externalId: 'synthetic-001',
          type: 'expense',
          amount: '25.90',
          occurredOn: '2026-09-30',
          description: 'Mercado',
          warnings: [],
        },
      ],
    });
  });

  it('normalizes an OFX 2.x UTF-8 credit-card statement without shifting its civil date', () => {
    const parsed = parser.parse(cardFixture);
    expect(parsed.variant).toBe('ofx_2_xml');
    expect(parsed.transactions).toEqual([
      {
        ordinal: 1,
        externalId: 'synthetic-card-001',
        type: 'income',
        amount: '102.50',
        occurredOn: '2026-10-01',
        description: 'Café da manhã',
        warnings: [],
      },
    ]);
  });

  it('uses the approved non-blocking fallback warning when FITID is absent', () => {
    const withoutFitid = Buffer.from(
      bankFixture.toString('ascii').replace('<FITID>synthetic-001', ''),
      'ascii',
    );
    expect(parser.parse(withoutFitid).transactions[0]).toMatchObject({
      externalId: null,
      warnings: ['external_id_missing'],
    });
  });

  it('accepts the approved ID alias when FITID is absent', () => {
    const withIdAlias = Buffer.from(
      bankFixture
        .toString('ascii')
        .replace('<FITID>synthetic-001', '<ID>synthetic-id-alias'),
      'ascii',
    );
    expect(parser.parse(withIdAlias).transactions[0]).toMatchObject({
      externalId: 'synthetic-id-alias',
      warnings: [],
    });
  });

  it('rejects pending transactions instead of silently omitting them', () => {
    const withPending = Buffer.from(
      cardFixture
        .toString('utf8')
        .replace('<BANKTRANLIST>', '<BANKTRANLISTP>')
        .replace('</BANKTRANLIST>', '</BANKTRANLISTP>'),
      'utf8',
    );
    expect(() => parser.parse(withPending)).toThrow(InvalidOfxFile);
  });

  it.each([
    ['PDF content', 'unsupported-pdf.pdf'],
    ['unsupported charset', 'unsupported-charset.ofx'],
    ['malformed OFX', 'malformed.ofx'],
  ])('rejects %s before yielding parsed rows', (_label, fixture) => {
    const content = readFileSync(
      new URL(`../../../../../test/fixtures/ofx/${fixture}`, import.meta.url),
    );
    expect(() => parser.parse(content)).toThrow(InvalidOfxFile);
  });

  it('rejects invalid UTF-8, unknown transaction types, zero amounts and files over 10 MiB', () => {
    expect(() => parser.parse(Buffer.from([0xff, 0xfe]))).toThrow(
      InvalidOfxFile,
    );
    const unknownType = Buffer.from(
      bankFixture
        .toString('ascii')
        .replace('<TRNTYPE>DEBIT', '<TRNTYPE>UNKNOWN'),
      'ascii',
    );
    const zeroAmount = Buffer.from(
      bankFixture.toString('ascii').replace('<TRNAMT>-25.90', '<TRNAMT>0.00'),
      'ascii',
    );
    expect(() => parser.parse(unknownType)).toThrow(InvalidOfxFile);
    expect(() => parser.parse(zeroAmount)).toThrow(InvalidOfxFile);
    expect(() => parser.parse(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(
      InvalidOfxFile,
    );
  });
});
