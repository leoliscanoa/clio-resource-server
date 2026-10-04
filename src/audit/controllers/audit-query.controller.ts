import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwksAuthGuard, ResponseDTO, CurrentUser } from '@lliscano/node-rest-commons';
import { AuditQueryService, TimelineQueryParams } from '../services/audit-query.service';
import {
  RebacAuditAuthorizer,
  UserSecurityContext,
} from '../security/rebac-audit.authorizer';
import { AuditDocument } from '../schemas/audit-document.schema';

@ApiTags('Auditoría Forense')
@ApiBearerAuth()
@Controller(['api/v1/audit', 'v1/audit'])
@UseGuards(JwksAuthGuard) // Protegido mediante RS256 contra cerbos-jwks
export class AuditQueryController {
  private readonly logger = new Logger(AuditQueryController.name);

  constructor(
    private readonly queryService: AuditQueryService,
    private readonly rebacAuthorizer: RebacAuditAuthorizer,
  ) {}

  @Get('entities/:entityName/:entityId')
  @ApiOperation({ summary: 'Historial cronológico de una entidad con validación ReBAC' })
  @ApiResponse({ status: 200, description: 'Historial de auditoría recuperado exitosamente' })
  @ApiResponse({ status: 403, description: 'Acceso denegado por políticas ReBAC' })
  async getEntityHistory(
    @Param('entityName') entityName: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ): Promise<ResponseDTO<AuditDocument[]>> {
    const userContext = this.extractUserContext(user, req);
    const correlationId =
      req?.headers?.['x-correlation-id'] || `trace-${Date.now()}`;

    this.logger.log(
      `REST_QUERY: Usuario [${userContext.username}] consulta historial para [${entityName}:${entityId}] en tenant [${userContext.tenantId}]`,
    );

    const history = await this.queryService.findEntityHistory(
      userContext.tenantId,
      entityName,
      entityId,
    );

    let targetService = 'unknown';
    let targetProjectId: string | null = null;

    if (history.length > 0) {
      targetService = history[0].serviceName || targetService;
      targetProjectId = history[0].projectId || null;
    } else {
      if (entityName === 'Project') {
        targetService = 'eia-java-resource-server';
        targetProjectId = entityId;
      } else if (entityName === 'User' || entityName === 'AppClient') {
        targetService = 'cerbos-resource-server';
        targetProjectId = null;
      }
    }

    // Validación ReBAC estricta
    await this.rebacAuthorizer.enforceRebacAccess(
      userContext,
      targetService,
      targetProjectId,
    );

    return {
      success: true,
      code: 'AUDIT_ENTITY_RETRIEVED',
      message: 'Historial de auditoría recuperado exitosamente.',
      data: history,
      timestamp: new Date().toISOString(),
      time: new Date().toISOString(),
      correlationId,
    };
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Línea de tiempo global con filtros y virtual scrolling' })
  @ApiResponse({ status: 200, description: 'Línea de tiempo de auditoría recuperada exitosamente' })
  async getTimeline(
    @Query() params: TimelineQueryParams,
    @CurrentUser() user: any,
    @Req() req: any,
  ): Promise<ResponseDTO<any>> {
    const userContext = this.extractUserContext(user, req);
    const correlationId =
      req?.headers?.['x-correlation-id'] || `trace-${Date.now()}`;

    const isGlobalSuperAdmin =
      userContext.roles.includes('SUPERADMIN') ||
      userContext.roles.includes('ROLE_SUPERADMIN');

    let allowedProjectIds: string[] | null = null;
    let isSuperAdmin = isGlobalSuperAdmin;

    if (!isGlobalSuperAdmin) {
      const eiaProfile = await this.rebacAuthorizer.fetchEiaUserProfile(
        userContext.userUuid,
        userContext.tenantId,
      );
      if (eiaProfile.isEiaAdmin) {
        isSuperAdmin = true;
      } else {
        allowedProjectIds = eiaProfile.assignedProjectIds || [];
      }
    }

    const result = await this.queryService.findTimeline(
      userContext.tenantId,
      params,
      allowedProjectIds,
      isSuperAdmin,
    );

    return {
      success: true,
      code: 'AUDIT_TIMELINE_RETRIEVED',
      message: 'Línea de tiempo de auditoría recuperada exitosamente.',
      data: result,
      timestamp: new Date().toISOString(),
      time: new Date().toISOString(),
      correlationId,
    };
  }

  @Delete('tenants/:tenantUuid/purge')
  @ApiOperation({ summary: 'Purga atómica del tenant (dropCollection)' })
  @ApiResponse({ status: 200, description: 'Colección de auditoría del inquilino purgada atómicamente' })
  @ApiResponse({ status: 403, description: 'Requiere privilegios administrativos' })
  async purgeTenant(
    @Param('tenantUuid') tenantUuid: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ): Promise<ResponseDTO<any>> {
    const userContext = this.extractUserContext(user, req);
    const correlationId =
      req?.headers?.['x-correlation-id'] || `trace-${Date.now()}`;

    const isAdmin =
      userContext.roles.includes('SUPERADMIN') ||
      userContext.roles.includes('ROLE_SUPERADMIN') ||
      userContext.roles.includes('ADMIN') ||
      userContext.roles.includes('ROLE_ADMIN');

    if (!isAdmin) {
      throw new ForbiddenException(
        'Acceso denegado: Se requiere rol administrativo para purgar inquilinos.',
      );
    }

    const result = await this.queryService.purgeTenant(tenantUuid);

    return {
      success: true,
      code: 'AUDIT_TENANT_PURGED',
      message: 'Colección de auditoría del inquilino purgada atómicamente de forma exitosa.',
      data: result,
      timestamp: new Date().toISOString(),
      time: new Date().toISOString(),
      correlationId,
    };
  }

  private extractUserContext(user: any, req: any): UserSecurityContext {
    const userUuid =
      user?.sub || user?.userUuid || user?.user_uuid || 'anonymous-user';
    const username =
      user?.username || user?.preferred_username || user?.sub || 'anonymous';
    const tenantId =
      user?.tenantId ||
      user?.tenant_id ||
      (req?.headers?.['x-tenant-id'] as string) ||
      'c0a80104-8c51-16be-818c-5107a3880000';

    let roles: string[] = [];
    if (Array.isArray(user?.roles)) {
      roles = user.roles;
    } else if (Array.isArray(user?.authorities)) {
      roles = user.authorities;
    } else if (typeof user?.roles === 'string') {
      roles = [user.roles];
    }

    return { userUuid, username, tenantId, roles };
  }
}
