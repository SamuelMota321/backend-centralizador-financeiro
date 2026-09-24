export type TenantContext = Readonly<{
  tenantId: string;
  userId: string;
}>;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class InvalidTenantContext extends Error {
  constructor() {
    super('Tenant context must contain canonical user and tenant UUIDs.');
    this.name = 'InvalidTenantContext';
  }
}

export function assertTenantContext(
  context: unknown,
): asserts context is TenantContext {
  if (typeof context !== 'object' || context === null) {
    throw new InvalidTenantContext();
  }
  const candidate = context as Record<string, unknown>;
  if (
    typeof candidate.tenantId !== 'string' ||
    typeof candidate.userId !== 'string' ||
    !CANONICAL_UUID.test(candidate.tenantId) ||
    !CANONICAL_UUID.test(candidate.userId)
  ) {
    throw new InvalidTenantContext();
  }
}
