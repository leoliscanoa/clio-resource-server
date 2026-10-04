import { AuditQueryController } from '../src/audit/controllers/audit-query.controller';
import { AuditQueryService } from '../src/audit/services/audit-query.service';
import { RebacAuditAuthorizer } from '../src/audit/security/rebac-audit.authorizer';
import { ForbiddenException } from '@nestjs/common';
import { AuditDocument } from '../src/audit/schemas/audit-document.schema';

describe('AuditQueryController', () => {
  let controller: AuditQueryController;
  let queryService: jest.Mocked<AuditQueryService>;
  let rebacAuthorizer: jest.Mocked<RebacAuditAuthorizer>;

  beforeEach(() => {
    queryService = {
      findEntityHistory: jest.fn(),
      findTimeline: jest.fn(),
      purgeTenant: jest.fn(),
    } as any;

    rebacAuthorizer = {
      enforceRebacAccess: jest.fn(),
      fetchEiaUserProfile: jest.fn(),
    } as any;

    controller = new AuditQueryController(queryService, rebacAuthorizer);
  });

  const mockUser = {
    sub: 'user-uuid-1',
    username: 'user.admin@email.com',
    tenantId: 'tenant-123',
    roles: ['PROJECTS', 'ADMIN'],
  };

  const mockReq = {
    headers: { 'x-correlation-id': 'corr-123' },
  };

  it('debe retornar 200 OK con ResponseDTO si la consulta de entidad es autorizada', async () => {
    const mockDoc: AuditDocument = {
      eventId: 'evt-1',
      correlationId: 'corr-1',
      tenantId: 'tenant-123',
      projectId: 'prj-100',
      serviceName: 'eia-java-resource-server',
      entityName: 'Project',
      entityId: 'prj-100',
      action: 'UPDATE',
      timestamp: new Date(),
      actor: { username: 'user.admin@email.com', clientId: 'EIA' },
    };

    queryService.findEntityHistory.mockResolvedValueOnce([mockDoc]);
    rebacAuthorizer.enforceRebacAccess.mockResolvedValueOnce({
      isSuperAdmin: true,
      allowedProjectIds: [],
    });

    const result = await controller.getEntityHistory('Project', 'prj-100', mockUser, mockReq);

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([mockDoc]);
    expect(rebacAuthorizer.enforceRebacAccess).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-123' }),
      'eia-java-resource-server',
      'prj-100',
    );
  });

  it('debe inferir servicio eia-java-resource-server cuando history está vacío para entidad Project', async () => {
    queryService.findEntityHistory.mockResolvedValueOnce([]);
    rebacAuthorizer.enforceRebacAccess.mockResolvedValueOnce({
      isSuperAdmin: true,
      allowedProjectIds: [],
    });

    const result = await controller.getEntityHistory('Project', 'prj-empty', mockUser, mockReq);
    expect(result.success).toBe(true);
    expect(rebacAuthorizer.enforceRebacAccess).toHaveBeenCalledWith(
      expect.anything(),
      'eia-java-resource-server',
      'prj-empty',
    );
  });

  it('debe inferir servicio cerbos-resource-server cuando history está vacío para entidad User', async () => {
    queryService.findEntityHistory.mockResolvedValueOnce([]);
    rebacAuthorizer.enforceRebacAccess.mockResolvedValueOnce({
      isSuperAdmin: true,
      allowedProjectIds: [],
    });

    const result = await controller.getEntityHistory('User', 'usr-empty', mockUser, mockReq);
    expect(result.success).toBe(true);
    expect(rebacAuthorizer.enforceRebacAccess).toHaveBeenCalledWith(
      expect.anything(),
      'cerbos-resource-server',
      null,
    );
  });

  it('debe inferir servicio cerbos-resource-server cuando history está vacío para entidad AppClient', async () => {
    queryService.findEntityHistory.mockResolvedValueOnce([]);
    rebacAuthorizer.enforceRebacAccess.mockResolvedValueOnce({
      isSuperAdmin: true,
      allowedProjectIds: [],
    });

    const result = await controller.getEntityHistory('AppClient', 'client-empty', mockUser, mockReq);
    expect(result.success).toBe(true);
    expect(rebacAuthorizer.enforceRebacAccess).toHaveBeenCalledWith(
      expect.anything(),
      'cerbos-resource-server',
      null,
    );
  });

  it('debe rechazar con 403 Forbidden si el evaluador ReBAC deniega el acceso a un proyecto', async () => {
    queryService.findEntityHistory.mockResolvedValueOnce([
      {
        eventId: 'evt-2',
        correlationId: 'corr-2',
        tenantId: 'tenant-123',
        projectId: 'prj-forbidden',
        serviceName: 'eia-java-resource-server',
        entityName: 'Project',
        entityId: 'prj-forbidden',
        action: 'UPDATE',
        timestamp: new Date(),
        actor: { username: 'other@email.com', clientId: 'EIA' },
      },
    ]);

    rebacAuthorizer.enforceRebacAccess.mockRejectedValueOnce(
      new ForbiddenException('Acceso denegado: No posee membresía en el proyecto'),
    );

    await expect(
      controller.getEntityHistory('Project', 'prj-forbidden', mockUser, mockReq),
    ).rejects.toThrow(ForbiddenException);
  });

  it('debe consultar timeline aplicando filtros ReBAC para PROJECT_LEAD', async () => {
    const leadUser = {
      sub: 'lead-uuid',
      username: 'lead@email.com',
      tenantId: 'tenant-123',
      roles: ['PROJECTS'],
    };

    rebacAuthorizer.fetchEiaUserProfile.mockResolvedValueOnce({
      isEiaAdmin: false,
      assignedProjectIds: ['prj-1', 'prj-2'],
    });

    queryService.findTimeline.mockResolvedValueOnce({
      content: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      isLast: true,
    });

    const result = await controller.getTimeline({}, leadUser, mockReq);

    expect(result.success).toBe(true);
    expect(queryService.findTimeline).toHaveBeenCalledWith(
      'tenant-123',
      {},
      ['prj-1', 'prj-2'],
      false,
    );
  });

  it('debe consultar timeline para Superadmin global sin consultar EIA ReBAC', async () => {
    const superAdminUser = {
      sub: 'admin-uuid',
      username: 'super@email.com',
      tenantId: 'tenant-123',
      roles: ['ROLE_SUPERADMIN'],
    };

    queryService.findTimeline.mockResolvedValueOnce({
      content: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      isLast: true,
    });

    const result = await controller.getTimeline({}, superAdminUser, mockReq);
    expect(result.success).toBe(true);
    expect(rebacAuthorizer.fetchEiaUserProfile).not.toHaveBeenCalled();
    expect(queryService.findTimeline).toHaveBeenCalledWith(
      'tenant-123',
      {},
      null,
      true,
    );
  });

  it('debe consultar timeline para usuario con rol ADMIN en EIA marcándolo como isSuperAdmin', async () => {
    const eiaAdminUser = {
      sub: 'eia-admin-uuid',
      username: 'eiaadmin@email.com',
      tenantId: 'tenant-123',
      roles: ['PROJECTS'],
    };

    rebacAuthorizer.fetchEiaUserProfile.mockResolvedValueOnce({
      isEiaAdmin: true,
      assignedProjectIds: [],
    });

    queryService.findTimeline.mockResolvedValueOnce({
      content: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
      isLast: true,
    });

    const result = await controller.getTimeline({}, eiaAdminUser, mockReq);
    expect(result.success).toBe(true);
    expect(queryService.findTimeline).toHaveBeenCalledWith(
      'tenant-123',
      {},
      null,
      true,
    );
  });

  it('debe extraer contexto adecuadamente cuando roles es array de authorities o string', async () => {
    const userWithAuthorities = {
      userUuid: 'auth-user',
      authorities: ['ROLE_USER'],
    };

    const emptyReq = { headers: { 'x-tenant-id': 'tenant-header' } };
    rebacAuthorizer.fetchEiaUserProfile.mockResolvedValueOnce({
      isEiaAdmin: false,
      assignedProjectIds: [],
    });
    queryService.findTimeline.mockResolvedValueOnce({} as any);

    await controller.getTimeline({}, userWithAuthorities, emptyReq);

    expect(queryService.findTimeline).toHaveBeenCalledWith(
      'tenant-header',
      {},
      [],
      false,
    );
  });

  it('debe purgar atómicamente el tenant si el usuario es SUPERADMIN', async () => {
    const superAdmin = {
      sub: 'super-admin-uuid',
      username: 'superadmin@email.com',
      tenantId: 'tenant-123',
      roles: ['SUPERADMIN'],
    };

    queryService.purgeTenant.mockResolvedValueOnce({
      tenantUuid: 'tenant-to-purge',
      droppedCollection: 'audit_trail_tenant-to-purge',
      executionTimeMs: 25,
    });

    const result = await controller.purgeTenant('tenant-to-purge', superAdmin, mockReq);

    expect(result.success).toBe(true);
    expect(result.code).toBe('AUDIT_TENANT_PURGED');
    expect(result.data.droppedCollection).toBe('audit_trail_tenant-to-purge');
  });

  it('debe rechazar la purga atómica con 403 si el usuario no tiene rol administrativo', async () => {
    const regularUser = {
      sub: 'user-uuid',
      username: 'user@email.com',
      tenantId: 'tenant-123',
      roles: ['PROJECTS'],
    };

    await expect(
      controller.purgeTenant('tenant-to-purge', regularUser, mockReq),
    ).rejects.toThrow(ForbiddenException);
  });
});
