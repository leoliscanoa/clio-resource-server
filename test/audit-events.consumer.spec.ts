import { AuditEventsConsumer } from '../src/audit/consumers/audit-events.consumer';
import { M2mSecurityEnvelopeValidator, AuditEventDTO } from '@lliscano/node-rest-commons';
import { AuditIngestionService } from '../src/audit/services/audit-ingestion.service';
import { UnauthorizedException } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

describe('AuditEventsConsumer', () => {
  let consumer: AuditEventsConsumer;
  let m2mValidator: jest.Mocked<M2mSecurityEnvelopeValidator>;
  let ingestionService: jest.Mocked<AuditIngestionService>;

  beforeEach(() => {
    m2mValidator = {
      validateAmqpToken: jest.fn(),
    } as any;

    ingestionService = {
      ingestEvent: jest.fn(),
    } as any;

    consumer = new AuditEventsConsumer(m2mValidator, ingestionService);
  });

  const mockEvent: AuditEventDTO = {
    eventId: 'evt-123',
    correlationId: 'corr-456',
    tenantId: 'tenant-789',
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
    properties: {
      headers: {
        Authorization: 'Bearer valid-jwt-token',
        'x-origin-service': 'cerbos-resource-server',
      },
    },
  } as unknown as ConsumeMessage;

  it('debe validar el sobre M2M e ingestar el evento con éxito', async () => {
    m2mValidator.validateAmqpToken.mockResolvedValueOnce({ sub: 'CERBOS' });
    ingestionService.ingestEvent.mockResolvedValueOnce(undefined);

    await expect(consumer.handleAuditEvent(mockEvent, mockRawMessage)).resolves.toBeUndefined();

    expect(m2mValidator.validateAmqpToken).toHaveBeenCalledWith('Bearer valid-jwt-token');
    expect(ingestionService.ingestEvent).toHaveBeenCalledWith(mockEvent);
  });

  it('debe rechazar y lanzar error si la validación M2M falla (para enviar a DLQ)', async () => {
    m2mValidator.validateAmqpToken.mockRejectedValueOnce(
      new UnauthorizedException('Token M2M inválido'),
    );

    await expect(consumer.handleAuditEvent(mockEvent, mockRawMessage)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(ingestionService.ingestEvent).not.toHaveBeenCalled();
  });
});
