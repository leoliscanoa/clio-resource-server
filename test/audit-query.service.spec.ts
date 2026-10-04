import { AuditQueryService, TimelineQueryParams } from '../src/audit/services/audit-query.service';
import { DynamicTenantCollectionResolver } from '../src/audit/services/dynamic-tenant-collection-resolver.service';
import { AuditDocument } from '../src/audit/schemas/audit-document.schema';

describe('AuditQueryService', () => {
  let service: AuditQueryService;
  let mockResolver: jest.Mocked<DynamicTenantCollectionResolver>;
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      read: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      countDocuments: jest.fn().mockReturnThis(),
    };

    mockResolver = {
      getModel: jest.fn().mockResolvedValue(mockModel),
      dropTenantCollection: jest.fn(),
    } as any;

    service = new AuditQueryService(mockResolver);
  });

  describe('findEntityHistory', () => {
    it('debe consultar historial en secundarios con orden descendente por timestamp', async () => {
      const mockDocs: Partial<AuditDocument>[] = [
        {
          eventId: 'evt-1',
          entityName: 'Project',
          entityId: 'prj-001',
          timestamp: new Date('2026-10-03T12:00:00Z'),
        },
      ];

      mockModel.exec.mockResolvedValueOnce(mockDocs);

      const result = await service.findEntityHistory('tenant-enel', 'Project', 'prj-001');

      expect(mockResolver.getModel).toHaveBeenCalledWith('tenant-enel');
      expect(mockModel.find).toHaveBeenCalledWith({ entityName: 'Project', entityId: 'prj-001' });
      expect(mockModel.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(mockModel.read).toHaveBeenCalledWith('secondaryPreferred');
      expect(result).toEqual(mockDocs);
    });
  });

  describe('findTimeline', () => {
    it('debe aplicar paginación por defecto y consultar secondaryPreferred para superadmin', async () => {
      const mockDocs: Partial<AuditDocument>[] = [
        { eventId: 'evt-1', entityName: 'User', timestamp: new Date() },
      ];

      mockModel.exec
        .mockResolvedValueOnce(mockDocs) // find()...exec()
        .mockResolvedValueOnce(1); // countDocuments()...exec()

      const params: TimelineQueryParams = {};
      const result = await service.findTimeline('tenant-123', params, null, true);

      expect(result.page).toBe(0);
      expect(result.size).toBe(50);
      expect(result.totalElements).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.isLast).toBe(true);
      expect(result.content).toEqual(mockDocs);
      expect(mockModel.find).toHaveBeenCalledWith({});
    });

    it('debe aplicar filtros multicriterio: serviceName, entityName, action, username, fechas', async () => {
      mockModel.exec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(0);

      const params: TimelineQueryParams = {
        page: 1,
        size: 20,
        serviceName: 'eia-java-resource-server',
        entityName: 'Project',
        action: 'UPDATE',
        username: 'lead.user@eia.com',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-03T23:59:59Z',
        projectId: 'prj-abc',
      };

      const result = await service.findTimeline('tenant-123', params, ['prj-abc'], true);

      expect(result.page).toBe(1);
      expect(result.size).toBe(20);
      expect(mockModel.skip).toHaveBeenCalledWith(20);
      expect(mockModel.limit).toHaveBeenCalledWith(20);
      expect(mockModel.find).toHaveBeenCalledWith({
        serviceName: 'eia-java-resource-server',
        entityName: 'Project',
        action: 'UPDATE',
        'actor.username': 'lead.user@eia.com',
        projectId: 'prj-abc',
        timestamp: {
          $gte: new Date('2026-10-01T00:00:00Z'),
          $lte: new Date('2026-10-03T23:59:59Z'),
        },
      });
    });

    it('HU-07: Para PROJECT_LEAD sin projectId explícito, inyecta { projectId: { $in: allowed } }', async () => {
      mockModel.exec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(0);

      const params: TimelineQueryParams = {};
      await service.findTimeline('tenant-123', params, ['PRJ-A', 'PRJ-B'], false);

      expect(mockModel.find).toHaveBeenCalledWith({
        projectId: { $in: ['PRJ-A', 'PRJ-B'] },
      });
    });

    it('HU-06: Para PROJECT_LEAD con projectId no asignado, retorna vacío inmediatamente', async () => {
      const params: TimelineQueryParams = { projectId: 'PRJ-AJENO' };
      const result = await service.findTimeline('tenant-123', params, ['PRJ-A'], false);

      expect(result.content).toEqual([]);
      expect(result.totalElements).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.isLast).toBe(true);
      expect(mockModel.find).not.toHaveBeenCalled();
    });

    it('Para PROJECT_LEAD con projectId asignado, filtra por dicho projectId', async () => {
      mockModel.exec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(0);

      const params: TimelineQueryParams = { projectId: 'PRJ-A' };
      await service.findTimeline('tenant-123', params, ['PRJ-A', 'PRJ-B'], false);

      expect(mockModel.find).toHaveBeenCalledWith({
        projectId: 'PRJ-A',
      });
    });
  });

  describe('purgeTenant', () => {
    it('HU-10: Purga atómicamente la colección y retorna metadatos', async () => {
      mockResolver.dropTenantCollection.mockResolvedValueOnce({
        droppedCollection: 'audit_trail_tenant-purge',
        executionTimeMs: 42,
      });

      const result = await service.purgeTenant('tenant-purge');

      expect(mockResolver.dropTenantCollection).toHaveBeenCalledWith('tenant-purge');
      expect(result).toEqual({
        tenantUuid: 'tenant-purge',
        droppedCollection: 'audit_trail_tenant-purge',
        executionTimeMs: 42,
      });
    });
  });
});
