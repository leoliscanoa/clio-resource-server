import { AuditEventsConsumer } from '../src/audit/consumers/audit-events.consumer';
import { AuditIngestionService } from '../src/audit/services/audit-ingestion.service';
import { SecurityIncidentService } from '../src/audit/services/security-incident.service';
import { M2mSecurityEnvelopeValidator, AuditEventDTO } from '@lliscano/node-rest-commons';
import { RejectionReason, SecurityIncident } from '../src/audit/schemas/security-incident.schema';
import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { UnauthorizedException } from '@nestjs/common';

describe('CerbosAuditIngestionE2ESuite (FEAT-030 Integration & Zero Trust)', () => {
  let consumer: AuditEventsConsumer;
  let m2mValidator: any;
  let ingestionService: any;
  let incidentService: any;

  const mockIngestedEvents: AuditEventDTO[] = [];
  const mockIncidents: any[] = [];

  beforeEach(() => {
    mockIngestedEvents.length = 0;
    mockIncidents.length = 0;

    m2mValidator = {
      validateAmqpSecurityEnvelope: jest.fn(async (authHeader: string) => {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          throw new UnauthorizedException('Cabecera AMQP Authorization ausente o sin formato Bearer');
        }
        const token = authHeader.replace('Bearer ', '');
        if (token === 'corrupted-rs256-jwt') {
          throw new UnauthorizedException('invalid signature');
        }
        if (token === 'expired-jwt') {
          throw new UnauthorizedException('jwt expired');
        }
        if (token === 'insufficient-scope-jwt') {
          return { sub: 'CERBOS', scope: ['other:scope'] };
        }
        if (token === 'valid-cerbos-m2m-jwt') {
          return { sub: 'CERBOS', scope: ['clio:audit:data', 'hermes:email:send'] };
        }
        throw new UnauthorizedException('invalid token');
      }),
    };

    ingestionService = {
      ingestEvent: jest.fn(async (event: AuditEventDTO) => {
        mockIngestedEvents.push(event);
      }),
    };

    incidentService = {
      recordIncident: jest.fn(async (data: Partial<SecurityIncident>) => {
        const incident = {
          ...data,
          incidentId: data.incidentId || 'inc-' + Math.random().toString(36).substring(7),
          timestamp: data.timestamp || new Date(),
          resolved: false,
        };
        mockIncidents.push(incident);
        return incident as any;
      }),
    };

    consumer = new AuditEventsConsumer(m2mValidator, ingestionService, incidentService);
  });

  const createRawMessage = (event: AuditEventDTO, token?: string, routingKey = 'audit.identity.user.update'): ConsumeMessage => {
    return {
      content: Buffer.from(JSON.stringify(event)),
      fields: {
        consumerTag: 'amq.ctag-1',
        deliveryTag: 1,
        redelivered: false,
        exchange: 'clio.topic.exchange',
        routingKey,
      },
      properties: {
        contentType: 'application/json',
        contentEncoding: 'UTF-8',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        deliveryMode: 2,
        priority: 0,
      },
    } as unknown as ConsumeMessage;
  };

  describe('HU-03 & HU-04: Emisión nativa de Auth Server e Ingesta Zero Trust', () => {
    it('debe procesar exitosamente un evento de AUTH_LOGIN_SUCCESS desde cerbos-authorization-server', async () => {
      const loginSuccessEvent: AuditEventDTO = {
        eventId: 'evt-auth-001',
        correlationId: 'corr-login-123',
        tenantId: 'tenant-global',
        projectId: null,
        serviceName: 'cerbos-authorization-server',
        entityName: 'AppUser',
        entityId: 'john.doe@company.com',
        action: 'AUTH_LOGIN_SUCCESS',
        timestamp: new Date().toISOString(),
        actor: {
          username: 'john.doe@company.com',
          clientId: 'CERBOS_SSO',
        },
      };

      const rawMsg = createRawMessage(loginSuccessEvent, 'valid-cerbos-m2m-jwt', 'audit.security.login.success');
      await consumer.handleAuditEvent(loginSuccessEvent, rawMsg);

      expect(mockIngestedEvents).toHaveLength(1);
      expect(mockIngestedEvents[0].eventId).toBe('evt-auth-001');
      expect(mockIngestedEvents[0].projectId).toBeNull();
      expect(mockIncidents).toHaveLength(0);
    });

    it('debe procesar evento AUTH_LOGIN_FAILED verificando sanitización de credenciales', async () => {
      const loginFailedEvent: AuditEventDTO = {
        eventId: 'evt-auth-002',
        correlationId: 'corr-login-fail-456',
        tenantId: 'tenant-global',
        projectId: null,
        serviceName: 'cerbos-authorization-server',
        entityName: 'AppUser',
        entityId: 'attacker@evil.com',
        action: 'AUTH_LOGIN_FAILED',
        timestamp: new Date().toISOString(),
        actor: {
          username: 'attacker@evil.com',
          clientId: 'CERBOS_SSO',
        },
        diff: {
          failureReason: { oldValue: null, newValue: 'BAD_CREDENTIALS' },
        },
      };

      const rawMsg = createRawMessage(loginFailedEvent, 'valid-cerbos-m2m-jwt', 'audit.security.login.failed');
      await consumer.handleAuditEvent(loginFailedEvent, rawMsg);

      expect(mockIngestedEvents).toHaveLength(1);
      expect(mockIngestedEvents[0].diff?.failureReason.newValue).toBe('BAD_CREDENTIALS');
      // Asegurar que no existe ningún campo password ni credencial en el diff
      expect((mockIngestedEvents[0].diff as any).password).toBeUndefined();
    });
  });

  describe('HU-02 & HU-04: Emisión de Mutaciones CRUD desde cerbos-resource-server', () => {
    it('debe ingestar mutación de AppClient con diff y projectId = null', async () => {
      const clientUpdateEvent: AuditEventDTO = {
        eventId: 'evt-res-001',
        correlationId: 'corr-res-789',
        tenantId: 'tenant-acme',
        projectId: null,
        serviceName: 'cerbos-resource-server',
        entityName: 'AppClient',
        entityId: 'ACME_PORTAL',
        action: 'UPDATE',
        timestamp: new Date().toISOString(),
        actor: {
          username: 'admin@acme.com',
          clientId: 'CERBOS',
        },
        diff: {
          clientName: { oldValue: 'Acme Old', newValue: 'Acme New' },
        },
      };

      const rawMsg = createRawMessage(clientUpdateEvent, 'valid-cerbos-m2m-jwt', 'audit.identity.client.update');
      await consumer.handleAuditEvent(clientUpdateEvent, rawMsg);

      expect(mockIngestedEvents).toHaveLength(1);
      expect(mockIngestedEvents[0].entityName).toBe('AppClient');
      expect(mockIngestedEvents[0].tenantId).toBe('tenant-acme');
      expect(mockIngestedEvents[0].projectId).toBeNull();
    });
  });

  describe('HU-07: Rechazo Zero Trust hacia DLQ y Registro Forense en Security Incidents', () => {
    const maliciousPayload: AuditEventDTO = {
      eventId: 'evt-hack-999',
      correlationId: 'corr-attack-001',
      tenantId: 'tenant-target',
      projectId: null,
      serviceName: 'cerbos-resource-server',
      entityName: 'AppUser',
      entityId: 'admin@target.com',
      action: 'UPDATE',
      timestamp: new Date().toISOString(),
      actor: { username: 'intruder', clientId: 'UNKNOWN' },
    };

    it('debe rechazar con basic.nack(false) cuando falta el token Authorization AMQP (MISSING_M2M_TOKEN)', async () => {
      const rawMsgWithoutAuth = createRawMessage(maliciousPayload, undefined);

      const result = await consumer.handleAuditEvent(maliciousPayload, rawMsgWithoutAuth);

      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(false);
      expect(mockIngestedEvents).toHaveLength(0);
      expect(mockIncidents).toHaveLength(1);
      expect(mockIncidents[0].rejectionReason).toBe(RejectionReason.MISSING_M2M_TOKEN);
      expect(mockIncidents[0].correlationId).toBe('corr-attack-001');
    });

    it('debe rechazar con basic.nack(false) cuando la firma RS256 es corrupta o inválida (INVALID_SIGNATURE)', async () => {
      const rawMsgWithCorruptedSig = createRawMessage(maliciousPayload, 'corrupted-rs256-jwt');

      const result = await consumer.handleAuditEvent(maliciousPayload, rawMsgWithCorruptedSig);

      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(false);
      expect(mockIngestedEvents).toHaveLength(0);
      expect(mockIncidents).toHaveLength(1);
      expect(mockIncidents[0].rejectionReason).toBe(RejectionReason.INVALID_SIGNATURE);
    });

    it('debe rechazar con basic.nack(false) cuando el token M2M está expirado (TOKEN_EXPIRED)', async () => {
      const rawMsgWithExpiredToken = createRawMessage(maliciousPayload, 'expired-jwt');

      const result = await consumer.handleAuditEvent(maliciousPayload, rawMsgWithExpiredToken);

      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(false);
      expect(mockIncidents).toHaveLength(1);
      expect(mockIncidents[0].rejectionReason).toBe(RejectionReason.TOKEN_EXPIRED);
    });

    it('debe rechazar con basic.nack(false) cuando el token carece del scope clio:audit:data (INSUFFICIENT_SCOPE)', async () => {
      const rawMsgWithBadScope = createRawMessage(maliciousPayload, 'insufficient-scope-jwt');

      const result = await consumer.handleAuditEvent(maliciousPayload, rawMsgWithBadScope);

      expect(result).toBeInstanceOf(Nack);
      expect((result as Nack).requeue).toBe(false);
      expect(mockIncidents).toHaveLength(1);
      expect(mockIncidents[0].rejectionReason).toBe(RejectionReason.INSUFFICIENT_SCOPE);
    });
  });
});
