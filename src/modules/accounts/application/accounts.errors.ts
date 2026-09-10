import type { DuplicateCandidate } from './account-view.js';

export class PossibleConnectedAccountDuplicate extends Error {
  override readonly name = 'PossibleConnectedAccountDuplicate';

  constructor(readonly candidates: DuplicateCandidate[]) {
    super('A possible connected-account duplicate requires confirmation.');
  }
}
