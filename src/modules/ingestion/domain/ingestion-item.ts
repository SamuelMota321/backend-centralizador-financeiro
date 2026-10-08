import { InvalidImportRunTransition } from './ingestion.errors.js';
import type {
  OfxIngestionWarning,
  OfxTransactionType,
} from './ofx-statement.js';

export type IngestionItemStatus =
  'previewed' | 'imported' | 'ignored_duplicate' | 'failed';

export type IngestionItemState = Readonly<{
  ordinal: number;
  externalId: string | null;
  type: OfxTransactionType;
  amount: string;
  occurredOn: string;
  description: string | null;
  status: IngestionItemStatus;
  isDuplicate: boolean | null;
  warnings: readonly OfxIngestionWarning[];
  errorCode: string | null;
}>;

export class IngestionItem {
  private constructor(readonly props: IngestionItemState) {}

  static preview(
    input: Readonly<{
      ordinal: number;
      externalId: string | null;
      type: OfxTransactionType;
      amount: string;
      occurredOn: string;
      description: string | null;
      isDuplicate: boolean;
      warnings: readonly OfxIngestionWarning[];
    }>,
  ): IngestionItem {
    return new IngestionItem({
      ...input,
      status: 'previewed',
      isDuplicate: input.isDuplicate,
      errorCode: null,
    });
  }

  markImported(): IngestionItem {
    return this.finish({
      status: 'imported',
      isDuplicate: false,
      errorCode: null,
    });
  }

  markIgnoredDuplicate(): IngestionItem {
    return this.finish({
      status: 'ignored_duplicate',
      isDuplicate: true,
      errorCode: null,
    });
  }

  markFailed(errorCode: string): IngestionItem {
    if (!/^[a-z][a-z0-9_]{0,99}$/u.test(errorCode)) {
      throw new InvalidImportRunTransition(
        'Ingestion item error code is invalid.',
      );
    }
    return this.finish({ status: 'failed', isDuplicate: null, errorCode });
  }

  private finish(
    result: Pick<IngestionItemState, 'status' | 'isDuplicate' | 'errorCode'>,
  ): IngestionItem {
    if (this.props.status !== 'previewed') {
      throw new InvalidImportRunTransition(
        'Ingestion item is already terminal.',
      );
    }
    return new IngestionItem({ ...this.props, ...result });
  }
}
