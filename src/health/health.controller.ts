import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseSecurityCheckService } from '../infrastructure/database/database-security-check.service.js';

type HealthResponse = Readonly<{ status: 'ok' }>;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseSecurity: DatabaseSecurityCheckService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Report whether the HTTP process is running' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Verify database connectivity and runtime-role safety',
  })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  @ApiServiceUnavailableResponse({
    description: 'Database or security baseline unavailable',
  })
  async ready(): Promise<HealthResponse> {
    await this.databaseSecurity.assertRuntimeRoleIsSafe();
    return { status: 'ok' };
  }
}
