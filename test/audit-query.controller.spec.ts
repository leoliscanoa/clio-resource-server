import { AuditQueryController } from '../src/audit/controllers/audit-query.controller';
import { AuditQueryService } from '../src/audit/services/audit-query.service';
import { NotFoundException } from '@nestjs/common';
import { EntityAuditTrail } from '../src/audit/schemas/entity-audit-trail.schema';

describe('AuditQueryController', () => {
  let controller: AuditQueryController;
  let queryService: jest.Mocked<AuditQueryService>;

  beforeEach(() => {
    queryService = {
      findTimelineByEntityId: jest.fn(),
    } as any;

    controller = new AuditQueryController(queryService);
  });

  it('debe retornar 200 OK con ResponseDTO si la entidad existe', async () => {
    const mockDoc = {
      _id: 'c0a80104-8c51-16be-818c-5107a3880000',
      entityName: 'User',
      serviceName: 'cerbos-resource-server',
      tenantId: 'tenant-1',
      totalEvents: 1,
      events: [],
    } as unknown as EntityAuditTrail;

    queryService.findTimelineByEntityId.mockResolvedValueOnce(mockDoc);

    const result = await controller.getEntityTimeline('c0a80104-8c51-16be-818c-5107a3880000');

    expect(result).toBeDefined();
    expect(result.data).toEqual(mockDoc);
    expect(result.message).toContain('exitosamente');
  });

  it('debe lanzar NotFoundException (404) si la entidad no existe', async () => {
    queryService.findTimelineByEntityId.mockResolvedValueOnce(null);

    await expect(controller.getEntityTimeline('non-existent-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
