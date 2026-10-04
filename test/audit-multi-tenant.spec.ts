import { DynamicTenantCollectionResolver } from '../src/audit/services/dynamic-tenant-collection-resolver.service';
import { RebacAuditAuthorizer } from '../src/audit/security/rebac-audit.authorizer';
import { AuditIngestionService } from '../src/audit/services/audit-ingestion.service';
import { ForbiddenException } from '@nestjs/common';
import { AuditEventDTO } from '@lliscano/node-rest-commons';

describe('AuditMultiTenantSuite (FEAT-029)', () => {
  describe('DynamicTenantCollectionResolver', () => {
    let resolver: DynamicTenantCollectionResolver;
    let mockConnection: any;
    let mockDb: any;
    let mockCollection: any;

    beforeEach(() => {
      mockCollection = {
        createIndexes: jest.fn().mockResolvedValue(['ix_entity_history']),
        drop: jest.fn().mockResolvedValue(true),
      };

      mockDb = {
        listCollections: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
        createCollection: jest.fn().mockResolvedValue(mockCollection),
        collection: jest.fn().mockReturnValue(mockCollection),
      };

      mockConnection = {
        db: mockDb,
        models: {},
        model: jest.fn().mockReturnValue({
          collection: mockCollection,
        }),
        deleteModel: jest.fn(),
      };

      resolver = new DynamicTenantCollectionResolver(mockConnection);
    });

    it('debe sanitizar y resolver el nombre físico de colección correctamente', () => {
      expect(resolver.resolveCollectionName('TENANT-ECOPETROL')).toBe('audit_trail_tenant-ecopetrol');
      expect(resolver.resolveCollectionName('c0a80104-8c51-16be-818c-5107a3880000')).toBe(
        'audit_trail_c0a80104-8c51-16be-818c-5107a3880000',
      );
    });

    it('debe rechazar identificadores de tenant con caracteres inválidos', () => {
      expect(() => resolver.resolveCollectionName('tenant$invalid')).toThrow();
      expect(() => resolver.resolveCollectionName('')).toThrow();
      expect(() => resolver.resolveCollectionName('tenant/hack')).toThrow();
    });

    it('debe aprovisionar perezosamente la colección e índices (incluyendo sparse en projectId)', async () => {
      const colName = await resolver.ensureTenantCollection('tenant-enel');

      expect(colName).toBe('audit_trail_tenant-enel');
      expect(mockDb.createCollection).toHaveBeenCalledWith('audit_trail_tenant-enel');
      expect(mockCollection.createIndexes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: { projectId: 1, timestamp: -1 },
            name: 'ix_rebac_project',
            sparse: true,
          }),
          expect.objectContaining({
            key: { eventId: 1 },
            name: 'uq_event_id',
            unique: true,
          }),
        ]),
      );
    });

    it('debe retornar inmediatamente si la colección ya fue aprovisionada en memoria', async () => {
      await resolver.ensureTenantCollection('tenant-cache');
      expect(mockDb.createCollection).toHaveBeenCalledTimes(1);

      const cachedName = await resolver.ensureTenantCollection('tenant-cache');
      expect(cachedName).toBe('audit_trail_tenant-cache');
      expect(mockDb.createCollection).toHaveBeenCalledTimes(1);
    });

    it('debe reutilizar promesa en vuelo si dos llamadas concurrentes ocurren simultáneamente', async () => {
      const [col1, col2] = await Promise.all([
        resolver.ensureTenantCollection('tenant-concurrent'),
        resolver.ensureTenantCollection('tenant-concurrent'),
      ]);

      expect(col1).toBe('audit_trail_tenant-concurrent');
      expect(col2).toBe('audit_trail_tenant-concurrent');
      expect(mockDb.createCollection).toHaveBeenCalledTimes(1);
    });

    it('debe fallar si connection.db no está inicializada', async () => {
      mockConnection.db = null;
      await expect(resolver.ensureTenantCollection('tenant-nodb')).rejects.toThrow(
        'Conexión a MongoDB no inicializada',
      );
    });

    it('no debe llamar a createCollection si la colección ya existe en la base de datos', async () => {
      mockDb.listCollections.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValueOnce([{ name: 'audit_trail_existing' }]),
      });

      const colName = await resolver.ensureTenantCollection('existing');
      expect(colName).toBe('audit_trail_existing');
      expect(mockDb.createCollection).not.toHaveBeenCalled();
    });

    it('debe retornar modelo existente si ya está registrado en connection.models', async () => {
      const existingModel = { mock: true };
      mockConnection.models['audit_trail_tenant-model'] = existingModel;

      const model = await resolver.getModel('tenant-model');
      expect(model).toBe(existingModel);
    });

    it('debe registrar y retornar nuevo modelo si no estaba en connection.models', async () => {
      const model = await resolver.getModel('tenant-new-model');
      expect(mockConnection.model).toHaveBeenCalled();
      expect(model).toBeDefined();
    });

    it('HU-10: dropTenantCollection debe eliminar colección y limpiar cachés', async () => {
      await resolver.ensureTenantCollection('tenant-drop');
      const dropResult = await resolver.dropTenantCollection('tenant-drop');

      expect(dropResult.droppedCollection).toBe('audit_trail_tenant-drop');
      expect(dropResult.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockDb.collection).toHaveBeenCalledWith('audit_trail_tenant-drop');
      expect(mockCollection.drop).toHaveBeenCalled();
      expect(mockConnection.deleteModel).toHaveBeenCalledWith('audit_trail_tenant-drop');
    });

    it('dropTenantCollection debe ignorar error si la colección no existía (NamespaceNotFound)', async () => {
      mockCollection.drop.mockRejectedValueOnce({
        codeName: 'NamespaceNotFound',
      });

      const dropResult = await resolver.dropTenantCollection('tenant-not-found');
      expect(dropResult.droppedCollection).toBe('audit_trail_tenant-not-found');
    });

    it('dropTenantCollection debe relanzar errores no esperados de MongoDB', async () => {
      mockCollection.drop.mockRejectedValueOnce(new Error('Fatal disk failure'));
      await expect(resolver.dropTenantCollection('tenant-err')).rejects.toThrow('Fatal disk failure');
    });

    it('evictCollectionCache debe desalojar la colección de la caché en memoria', async () => {
      await resolver.ensureTenantCollection('tenant-evict');
      resolver.evictCollectionCache('tenant-evict');

      await resolver.ensureTenantCollection('tenant-evict');
      expect(mockDb.createCollection).toHaveBeenCalledTimes(2);
    });
  });

  describe('RebacAuditAuthorizer (Visión 360°)', () => {
    let authorizer: RebacAuditAuthorizer;

    beforeEach(() => {
      authorizer = new RebacAuditAuthorizer();
    });

    it('Superadmin global (SUPERADMIN o ROLE_SUPERADMIN) tiene acceso irrestricto', async () => {
      const context1 = {
        userUuid: 'root-1',
        username: 'root',
        tenantId: 'tenant-1',
        roles: ['SUPERADMIN'],
      };
      const res1 = await authorizer.enforceRebacAccess(context1, 'any-service', 'any-prj');
      expect(res1.isSuperAdmin).toBe(true);

      const context2 = {
        userUuid: 'root-2',
        username: 'root2',
        tenantId: 'tenant-1',
        roles: ['ROLE_SUPERADMIN'],
      };
      const res2 = await authorizer.enforceRebacAccess(context2, 'any-service', null);
      expect(res2.isSuperAdmin).toBe(true);
    });

    it('HU-04: Superadmin de EIA consulta cualquier proyecto del tenant', async () => {
      jest.spyOn(authorizer, 'fetchEiaUserProfile').mockResolvedValueOnce({
        isEiaAdmin: true,
        assignedProjectIds: [],
      });

      const context = {
        userUuid: 'admin-uuid',
        username: 'super.admin@eia.com',
        tenantId: 'tenant-1',
        roles: ['PROJECTS'],
      };

      const result = await authorizer.enforceRebacAccess(
        context,
        'eia-java-resource-server',
        'PRJ-SUR',
      );

      expect(result.isSuperAdmin).toBe(true);
    });

    it('HU-05: PROJECT_LEAD consulta en modo READ su proyecto asignado', async () => {
      jest.spyOn(authorizer, 'fetchEiaUserProfile').mockResolvedValueOnce({
        isEiaAdmin: false,
        assignedProjectIds: ['PRJ-NORTE'],
      });

      const context = {
        userUuid: 'lead-uuid',
        username: 'lead.user@eia.com',
        tenantId: 'tenant-1',
        roles: ['PROJECTS'],
      };

      const result = await authorizer.enforceRebacAccess(
        context,
        'eia-java-resource-server',
        'PRJ-NORTE',
      );

      expect(result.isSuperAdmin).toBe(false);
      expect(result.allowedProjectIds).toContain('PRJ-NORTE');
    });

    it('HU-06: Rechazo estricto con 403 Forbidden a PROJECT_LEAD que intenta auditar proyecto ajeno', async () => {
      jest.spyOn(authorizer, 'fetchEiaUserProfile').mockResolvedValueOnce({
        isEiaAdmin: false,
        assignedProjectIds: ['PRJ-NORTE'],
      });

      const context = {
        userUuid: 'lead-uuid',
        username: 'lead.user@eia.com',
        tenantId: 'tenant-1',
        roles: ['PROJECTS'],
      };

      await expect(
        authorizer.enforceRebacAccess(context, 'eia-java-resource-server', 'PRJ-SUR'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Entidad con proyecto: rechaza con 403 si el usuario no tiene rol PROJECTS', async () => {
      const context = {
        userUuid: 'user-sin-projects',
        username: 'user@email.com',
        tenantId: 'tenant-1',
        roles: ['AUDITOR'],
      };

      await expect(
        authorizer.enforceRebacAccess(context, 'eia-java-resource-server', 'PRJ-01'),
      ).rejects.toThrow('El usuario no posee permisos para acceder al módulo de proyectos.');
    });

    it('HU-11 & HU-12: Cerberos ADMIN puede auditar identidades (projectId = null)', async () => {
      const context = {
        userUuid: 'cerbos-admin-uuid',
        username: 'admin@cerbos.com',
        tenantId: 'tenant-1',
        roles: ['ADMIN'],
      };

      const result = await authorizer.enforceRebacAccess(
        context,
        'cerbos-resource-server',
        null,
      );

      expect(result.isSuperAdmin).toBe(true);
    });

    it('Cerberos SSO: usuario con ROLE_ADMIN o CERBOS_ADMIN puede auditar identidades', async () => {
      const context1 = {
        userUuid: 'u-1',
        username: 'u1@cerbos.com',
        tenantId: 'tenant-1',
        roles: ['ROLE_ADMIN'],
      };
      const res1 = await authorizer.enforceRebacAccess(context1, 'cerbos-resource-server', null);
      expect(res1.isSuperAdmin).toBe(true);

      const context2 = {
        userUuid: 'u-2',
        username: 'u2@cerbos.com',
        tenantId: 'tenant-1',
        roles: ['CERBOS_ADMIN'],
      };
      const res2 = await authorizer.enforceRebacAccess(context2, 'cerbos-resource-server', null);
      expect(res2.isSuperAdmin).toBe(true);
    });

    it('HU-12: PROJECT_LEAD de EIA sin rol ADMIN en Cerberos recibe 403 al intentar auditar identidades', async () => {
      const context = {
        userUuid: 'lead-uuid',
        username: 'lead.user@eia.com',
        tenantId: 'tenant-1',
        roles: ['PROJECTS'],
      };

      await expect(
        authorizer.enforceRebacAccess(context, 'cerbos-resource-server', null),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Entidad sin proyecto en otro microservicio (ej. Hermes): valida rol administrativo del servicio', async () => {
      const contextAdmin = {
        userUuid: 'hermes-adm-uuid',
        username: 'admin@hermes.com',
        tenantId: 'tenant-1',
        roles: ['HERMES_ADMIN'],
      };

      const res = await authorizer.enforceRebacAccess(
        contextAdmin,
        'hermes-resource-server',
        null,
      );
      expect(res.isSuperAdmin).toBe(true);

      const contextUser = {
        userUuid: 'hermes-usr-uuid',
        username: 'user@hermes.com',
        tenantId: 'tenant-1',
        roles: ['HERMES_VIEWER'],
      };

      await expect(
        authorizer.enforceRebacAccess(contextUser, 'hermes-resource-server', null),
      ).rejects.toThrow('No posee privilegios para auditar el servicio hermes-resource-server.');
    });

    it('fetchEiaUserProfile debe consultar endpoint HTTP y mapear respuesta exitosa', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({
          data: { isEiaAdmin: true, assignedProjectIds: ['PRJ-X'] },
        }),
      });
      global.fetch = mockFetch as any;

      const profile = await authorizer.fetchEiaUserProfile('uuid-123', 'tenant-1');
      expect(profile).toEqual({ isEiaAdmin: true, assignedProjectIds: ['PRJ-X'] });
    });

    it('fetchEiaUserProfile debe retornar fallback seguro si EIA responde error HTTP', async () => {
      const mockFetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      global.fetch = mockFetch as any;

      const profile = await authorizer.fetchEiaUserProfile('uuid-123', 'tenant-1');
      expect(profile).toEqual({ isEiaAdmin: false, assignedProjectIds: [] });
    });

    it('fetchEiaUserProfile debe retornar fallback seguro si fetch lanza excepción de red o timeout', async () => {
      const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network error / connection refused'));
      global.fetch = mockFetch as any;

      const profile = await authorizer.fetchEiaUserProfile('uuid-123', 'tenant-1');
      expect(profile).toEqual({ isEiaAdmin: false, assignedProjectIds: [] });
    });
  });

  describe('AuditIngestionService & WriteConcern majority', () => {
    let ingestionService: AuditIngestionService;
    let mockResolver: any;
    let mockModel: any;

    beforeEach(() => {
      mockModel = {
        collection: {
          insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        },
      };
      mockResolver = {
        getModel: jest.fn().mockResolvedValue(mockModel),
      };
      ingestionService = new AuditIngestionService(mockResolver);
    });

    it('HU-01: Ingesta con w: majority y aislamiento de tenant', async () => {
      const event: AuditEventDTO = {
        eventId: 'evt-001',
        correlationId: 'corr-001',
        tenantId: 'tenant-enel',
        projectId: 'PRJ-001',
        serviceName: 'eia-java-resource-server',
        entityName: 'Project',
        entityId: 'PRJ-001',
        action: 'UPDATE',
        timestamp: new Date(),
        actor: { username: 'test@user.com', clientId: 'EIA' },
      };

      await ingestionService.ingestEvent(event);

      expect(mockResolver.getModel).toHaveBeenCalledWith('tenant-enel');
      expect(mockModel.collection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-001',
          tenantId: 'tenant-enel',
          projectId: 'PRJ-001',
        }),
        expect.objectContaining({
          writeConcern: { w: 'majority', j: true },
        }),
      );
    });

    it('debe propagar error si insertOne falla en la base de datos', async () => {
      mockModel.collection.insertOne.mockRejectedValueOnce(new Error('Mongo write error'));

      const event: AuditEventDTO = {
        eventId: 'evt-002',
        correlationId: 'corr-002',
        tenantId: 'tenant-fail',
        projectId: null,
        serviceName: 'cerbos-resource-server',
        entityName: 'User',
        entityId: 'usr-1',
        action: 'CREATE',
        timestamp: new Date(),
        actor: { username: 'admin@cerbos.com', clientId: 'CERBOS' },
      };

      await expect(ingestionService.ingestEvent(event)).rejects.toThrow('Mongo write error');
    });
  });
});
