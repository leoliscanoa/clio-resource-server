import { SecurityAlertsController } from '../src/audit/controllers/security-alerts.controller';
import { SecurityIncidentService } from '../src/audit/services/security-incident.service';
import { RejectionReason } from '../src/audit/schemas/security-incident.schema';

describe('SecurityAlertsController & SecurityIncidentService', () => {
  let controller: SecurityAlertsController;
  let incidentService: jest.Mocked<SecurityIncidentService>;

  beforeEach(() => {
    incidentService = {
      recordIncident: jest.fn(),
      findIncidents: jest.fn(),
      resolveIncident: jest.fn(),
    } as any;

    controller = new SecurityAlertsController(incidentService);
  });

  it('debe listar incidentes de seguridad paginados', async () => {
    const mockData = {
      content: [
        {
          incidentId: 'inc-123',
          timestamp: new Date(),
          rejectionReason: RejectionReason.INVALID_SIGNATURE,
          exchange: 'clio.topic.exchange',
          routingKey: 'audit.identity.user.update',
          correlationId: 'corr-001',
          rawHeaders: {},
          resolved: false,
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
      isLast: true,
    };

    incidentService.findIncidents.mockResolvedValueOnce(mockData as any);

    const result = await controller.getSecurityAlerts(
      0,
      20,
      RejectionReason.INVALID_SIGNATURE,
      false,
      undefined,
      undefined,
      { headers: { 'x-correlation-id': 'corr-req-1' } },
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe('SECURITY_ALERTS_RETRIEVED');
    expect(result.data.totalElements).toBe(1);
    expect(result.correlationId).toBe('corr-req-1');
    expect(incidentService.findIncidents).toHaveBeenCalledWith({
      page: 0,
      size: 20,
      reason: RejectionReason.INVALID_SIGNATURE,
      resolved: false,
      startDate: undefined,
      endDate: undefined,
    });
  });

  it('debe resolver un incidente de seguridad', async () => {
    const mockUpdated = {
      incidentId: 'inc-123',
      resolved: true,
      resolvedBy: 'admin@cerbos.com',
      resolutionNotes: 'Verified deployment key rotation',
      toObject: () => ({
        incidentId: 'inc-123',
        resolved: true,
        resolvedBy: 'admin@cerbos.com',
        resolutionNotes: 'Verified deployment key rotation',
      }),
    };

    incidentService.resolveIncident.mockResolvedValueOnce(mockUpdated as any);

    const result = await controller.resolveAlert(
      'inc-123',
      { resolutionNotes: 'Verified deployment key rotation' },
      { sub: 'admin@cerbos.com' },
      { headers: { 'x-correlation-id': 'corr-req-2' } },
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe('SECURITY_INCIDENT_RESOLVED');
    expect(result.data.resolved).toBe(true);
    expect(incidentService.resolveIncident).toHaveBeenCalledWith(
      'inc-123',
      'Verified deployment key rotation',
      'admin@cerbos.com',
    );
  });
});
