import { SecurityIncidentService } from '../src/audit/services/security-incident.service';
import { RejectionReason } from '../src/audit/schemas/security-incident.schema';
import { NotFoundException } from '@nestjs/common';

describe('SecurityIncidentService', () => {
  let service: SecurityIncidentService;
  let mockModel: any;

  beforeEach(() => {
    mockModel = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue({
        ...data,
        _id: 'mongo-id-123',
      }),
    }));

    mockModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  incidentId: 'inc-001',
                  rejectionReason: RejectionReason.MISSING_M2M_TOKEN,
                  timestamp: new Date('2026-10-03T10:00:00Z'),
                  resolved: false,
                },
              ]),
            }),
          }),
        }),
      }),
    });

    mockModel.countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    mockModel.findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn(),
    });

    service = new SecurityIncidentService(mockModel as any);
  });

  describe('recordIncident', () => {
    it('debe registrar un incidente con valores por defecto y persistirlo', async () => {
      const incident = await service.recordIncident({
        rejectionReason: RejectionReason.INVALID_SIGNATURE,
        correlationId: 'corr-test',
        exchange: 'clio.topic.exchange',
        routingKey: 'audit.identity.user.update',
      });

      expect(incident.rejectionReason).toBe(RejectionReason.INVALID_SIGNATURE);
      expect(incident.correlationId).toBe('corr-test');
      expect(incident.resolved).toBe(false);
      expect(incident.incidentId).toBeDefined();
    });

    it('debe utilizar valores explícitos cuando se suministran', async () => {
      const customDate = new Date('2026-10-01T12:00:00Z');
      const incident = await service.recordIncident({
        incidentId: 'custom-inc-id',
        timestamp: customDate,
        rejectionReason: RejectionReason.INSUFFICIENT_SCOPE,
        sourceIp: '192.168.1.50',
        rawHeaders: { Authorization: 'Bearer xxx' },
        payloadSnippet: '{"entity":"User"}',
      });

      expect(incident.incidentId).toBe('custom-inc-id');
      expect(incident.timestamp).toBe(customDate);
      expect(incident.sourceIp).toBe('192.168.1.50');
      expect(incident.payloadSnippet).toBe('{"entity":"User"}');
    });
  });

  describe('findIncidents', () => {
    it('debe paginar y filtrar incidentes correctamente', async () => {
      const result = await service.findIncidents({
        page: 0,
        size: 10,
        reason: RejectionReason.MISSING_M2M_TOKEN,
        resolved: false,
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-03T23:59:59Z',
      });

      expect(result.content.length).toBe(1);
      expect(result.page).toBe(0);
      expect(result.size).toBe(10);
      expect(result.totalElements).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.isLast).toBe(true);

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          rejectionReason: RejectionReason.MISSING_M2M_TOKEN,
          resolved: false,
          timestamp: {
            $gte: new Date('2026-10-01T00:00:00Z'),
            $lte: new Date('2026-10-03T23:59:59Z'),
          },
        }),
      );
    });

    it('debe manejar filtros vacíos y rangos de fechas parciales', async () => {
      const result = await service.findIncidents({
        startDate: '2026-10-01T00:00:00Z',
      });

      expect(result.content).toBeDefined();
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: {
            $gte: new Date('2026-10-01T00:00:00Z'),
          },
        }),
      );
    });
  });

  describe('resolveIncident', () => {
    it('debe marcar el incidente como resuelto exitosamente', async () => {
      const updatedMock = {
        incidentId: 'inc-001',
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: 'security-admin@corp.com',
        resolutionNotes: 'Auditoría forense completada y verificada',
      };

      mockModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedMock),
      });

      const result = await service.resolveIncident(
        'inc-001',
        'Auditoría forense completada y verificada',
        'security-admin@corp.com',
      );

      expect(result.resolved).toBe(true);
      expect(result.resolvedBy).toBe('security-admin@corp.com');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { incidentId: 'inc-001' },
        expect.objectContaining({
          $set: expect.objectContaining({
            resolved: true,
            resolvedBy: 'security-admin@corp.com',
            resolutionNotes: 'Auditoría forense completada y verificada',
          }),
        }),
        { new: true },
      );
    });

    it('debe lanzar NotFoundException si el incidente no existe', async () => {
      mockModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.resolveIncident('inc-unknown', 'Notes', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
