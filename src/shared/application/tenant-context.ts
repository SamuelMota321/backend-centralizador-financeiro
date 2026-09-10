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

export function assertTenantContext(context: TenantContext): void {
  if (
    !CANONICAL_UUID.test(context.tenantId) ||
    !CANONICAL_UUID.test(context.userId)
  ) {
    throw new InvalidTenantContext();
  }
}
