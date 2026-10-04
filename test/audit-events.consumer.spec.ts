import { AuditEventsConsumer } from '../src/audit/consumers/audit-events.consumer';
import { M2mSecurityEnvelopeValidator, AuditEventDTO } from '@lliscano/node-rest-commons';
import { AuditIngestionService } from '../src/audit/services/audit-ingestion.service';
import { SecurityIncidentService } from '../src/audit/services/security-incident.service';
import { RejectionReason } from '../src/audit/schemas/security-incident.schema';
import { UnauthorizedException } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';

describe('AuditEventsConsumer', () => {
  let consumer: AuditEventsConsumer;
  let m2mValidator: jest.Mocked<M2mSecurityEnvelopeValidator>;
  let ingestionService: jest.Mocked<AuditIngestionService>;
  let incidentService: jest.Mocked<SecurityIncidentService>;

  beforeEach(() => {
    m2mValidator = {
      validateAmqpSecurityEnvelope: jest.fn(),
      validateAmqpToken: jest.fn(),
    } as any;

    ingestionService = {
      ingestEvent: jest.fn(),
    } as any;

    incidentService = {
      recordIncident: jest.fn().mockResolvedValue({} as any),
      findIncidents: jest.fn(),
      resolveIncident: jest.fn(),
    } as any;

    consumer = new AuditEventsConsumer(m2mValidator, ingestionService, incidentService);
  });

  const mockEvent: AuditEventDTO = {
    eventId: 'evt-123',
    correlationId: 'corr-456',
    tenantId: 'tenant-789',
    projectId: null,
    serviceName: 'cerbos-resource-server',
    entityName: 'User',
    entityId: 'c0a80104-8c51-16be-818c-5107a3880000',
    action: 'UPDATE',
    timestamp: new Date().toISOString(),
    actor: {
      username: 'user.admin@email.com',
      clientId: 'CERBOS',
    },
    diff: {
      lastName: { oldValue: 'ADMIN', newValue: 'SUPER_ADMIN' },
    },
  };

  const mockRawMessage = {
    content: Buffer.from(JSON.stringify(mockEvent)),
    fields: {
      exchange: 'clio.topic.exchange',
      routingKey: 'audit.identity.user.update',
    },
    properties: {
      headers: {
        Authorization: 'Bearer valid-jwt-token',
        'x-origin-service': 'cerbos-resource-server',
      },
    },
  } as unknown as ConsumeMessage;

  it('debe validar el sobre M2M e ingestar el evento con éxito (projectId = null y scope clio:audit:data)', async () => {
    m2mValidator.validateAmqpSecurityEnvelope.mockResolvedValueOnce({
      sub: 'CERBOS',
      scope: ['clio:audit:data'],
    });
    ingestionService.ingestEvent.mockResolvedValueOnce(undefined);

    await expect(consumer.handleAuditEvent(mockEvent, mockRawMessage)).resolves.toBeUndefined();

    expect(m2mValidator.validateAmqpSecurityEnvelope).toHaveBeenCalledWith('Bearer valid-jwt-token');
    expect(ingestionService.ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-789',
        projectId: null,
      }),
    );
    expect(incidentService.recordIncident).not.toHaveBeenCalled();
  });

  it('debe registrar incidente MISSING_M2M_TOKEN y retornar Nack(false) sin bucle infinito', async () => {
    const rawMsgNoAuth = {
      content: Buffer.from(JSON.stringify(mockEvent)),
      fields: { exchange: 'clio.topic.exchange', routingKey: 'audit.identity.user.update' },
      properties: { headers: {} },
    } as unknown as ConsumeMessage;

    const result = await consumer.handleAuditEvent(mockEvent, rawMsgNoAuth);
    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);

    expect(incidentService.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: RejectionReason.MISSING_M2M_TOKEN,
      }),
    );
    expect(ingestionService.ingestEvent).not.toHaveBeenCalled();
  });

  it('debe registrar incidente INVALID_SIGNATURE y retornar Nack(false) si falla verificación criptográfica', async () => {
    m2mValidator.validateAmqpSecurityEnvelope.mockRejectedValueOnce(
      new UnauthorizedException('invalid signature'),
    );

    const result = await consumer.handleAuditEvent(mockEvent, mockRawMessage);
    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);

    expect(incidentService.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: RejectionReason.INVALID_SIGNATURE,
      }),
    );
    expect(ingestionService.ingestEvent).not.toHaveBeenCalled();
  });

  it('debe registrar incidente TOKEN_EXPIRED si el token M2M está expirado', async () => {
    m2mValidator.validateAmqpSecurityEnvelope.mockRejectedValueOnce(
      new UnauthorizedException('jwt expired'),
    );

    const result = await consumer.handleAuditEvent(mockEvent, mockRawMessage);
    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);

    expect(incidentService.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: RejectionReason.TOKEN_EXPIRED,
      }),
    );
  });

  it('debe registrar incidente INSUFFICIENT_SCOPE si el token carece de scope clio:audit:data', async () => {
    m2mValidator.validateAmqpSecurityEnvelope.mockResolvedValueOnce({
      sub: 'CERBOS',
      scope: ['read:users'],
    });

    const result = await consumer.handleAuditEvent(mockEvent, mockRawMessage);
    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);

    expect(incidentService.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: RejectionReason.INSUFFICIENT_SCOPE,
      }),
    );
  });

  it('debe registrar incidente MISSING_TENANT_ID y retornar Nack(false) si falta tenantId', async () => {
    m2mValidator.validateAmqpSecurityEnvelope.mockResolvedValueOnce({
      sub: 'CERBOS',
      scope: ['clio:audit:data'],
    });
    const eventWithoutTenant = { ...mockEvent, tenantId: '' };

    const result = await consumer.handleAuditEvent(eventWithoutTenant, mockRawMessage);
    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);

    expect(incidentService.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectionReason: RejectionReason.MISSING_TENANT_ID,
      }),
    );
    expect(ingestionService.ingestEvent).not.toHaveBeenCalled();
  });
});
