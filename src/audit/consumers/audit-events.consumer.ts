import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { M2mSecurityEnvelopeValidator, AuditEventDTO } from '@lliscano/node-rest-commons';
import { AuditIngestionService } from '../services/audit-ingestion.service';
import { SecurityIncidentService } from '../services/security-incident.service';
import { RejectionReason } from '../schemas/security-incident.schema';

const CLIO_EXCHANGE = process.env.RABBITMQ_AUDIT_EXCHANGE || 'clio.topic.exchange';
const CLIO_QUEUE = process.env.RABBITMQ_AUDIT_QUEUE || 'clio-events-queue';
const CLIO_ROUTING_KEYS = ['audit.#', 'clio.#'];
const CLIO_DLX = process.env.RABBITMQ_AUDIT_DLX || 'clio.topic.exchange';
const CLIO_DLQ_KEY = process.env.RABBITMQ_AUDIT_DLQ_KEY || 'audit.dlq';

@Injectable()
export class AuditEventsConsumer {
  private readonly logger = new Logger(AuditEventsConsumer.name);

  constructor(
    private readonly m2mValidator: M2mSecurityEnvelopeValidator,
    private readonly ingestionService: AuditIngestionService,
    private readonly incidentService: SecurityIncidentService,
  ) {}

  @RabbitSubscribe({
    exchange: CLIO_EXCHANGE,
    routingKey: CLIO_ROUTING_KEYS,
    queue: CLIO_QUEUE,
    queueOptions: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': CLIO_DLX,
        'x-dead-letter-routing-key': CLIO_DLQ_KEY,
      },
    },
  })
  public async handleAuditEvent(event: AuditEventDTO, msg: ConsumeMessage): Promise<void | Nack> {
    const correlationId =
      (msg?.properties?.headers?.['X-Correlation-ID'] as string) ||
      (msg?.properties?.headers?.['x-correlation-id'] as string) ||
      event?.correlationId ||
      'UNKNOWN_CORRELATION';

    try {
      const authHeader =
        (msg?.properties?.headers?.['Authorization'] as string) ||
        (msg?.properties?.headers?.['authorization'] as string);

      // 1. Verificación de presencia de cabecera de seguridad
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        await this.handleSecurityRejection(
          RejectionReason.MISSING_M2M_TOKEN,
          correlationId,
          msg,
          'Cabecera AMQP Authorization ausente o sin formato Bearer',
        );
        // NACK sin requeue (requeue = false): deriva a DLQ y evita bucle infinito
        return new Nack(false);
      }

      // 2. Validación criptográfica RS256 contra cerbos-authorization-server /oauth2/sso/jwks
      let decodedToken: any;
      try {
        decodedToken = await this.m2mValidator.validateAmqpSecurityEnvelope(authHeader);
      } catch (cryptoError: any) {
        const reason = cryptoError.message?.includes('expired')
          ? RejectionReason.TOKEN_EXPIRED
          : RejectionReason.INVALID_SIGNATURE;

        await this.handleSecurityRejection(
          reason,
          correlationId,
          msg,
          `Validación criptográfica fallida: ${cryptoError.message}`,
        );
        return new Nack(false);
      }

      // 3. Validación de Scope M2M requerido para Clio
      const scopes = decodedToken?.scope || decodedToken?.scopes || [];
      const hasScope = Array.isArray(scopes)
        ? scopes.includes('clio:audit:data')
        : typeof scopes === 'string' && scopes.includes('clio:audit:data');

      if (!hasScope) {
        await this.handleSecurityRejection(
          RejectionReason.INSUFFICIENT_SCOPE,
          correlationId,
          msg,
          'Token M2M carece del scope obligatorio clio:audit:data',
        );
        return new Nack(false);
      }

      // 4. Validación mandatoria de tenantId
      if (!event || !event.tenantId || event.tenantId.trim() === '') {
        await this.handleSecurityRejection(
          RejectionReason.MISSING_TENANT_ID,
          correlationId,
          msg,
          'Evento carece de identificador de inquilino (tenantId)',
        );
        return new Nack(false);
      }

      // projectId es opcional para Cerberos (null)
      if (!event.projectId) {
        event.projectId = null;
      }

      // 5. Ingesta normal en MongoDB Clúster
      await this.ingestionService.ingestEvent(event);
      this.logger.log(`[${correlationId}] Evento persistido con éxito en tenant ${event.tenantId} (entidad: ${event.entityName}, acción: ${event.action})`);
    } catch (unhandledError: any) {
      this.logger.error(
        `[${correlationId}] Error no controlado en consumidor AMQP: ${unhandledError.message}`,
        unhandledError.stack,
      );
      return new Nack(false);
    }
  }

  private async handleSecurityRejection(
    reason: RejectionReason,
    correlationId: string,
    msg: ConsumeMessage,
    detailMessage: string,
  ): Promise<void> {
    // Log SIEM estructurado
    this.logger.error(
      `[SECURITY_ALERT] Inyección no autorizada rechazada [${reason}] Correlación: ${correlationId}. Motivo: ${detailMessage}`,
    );

    // Registro forense inmutable en colección clio.security_incidents
    try {
      await this.incidentService.recordIncident({
        rejectionReason: reason,
        correlationId,
        exchange: msg?.fields?.exchange || 'clio.topic.exchange',
        routingKey: msg?.fields?.routingKey || 'unknown',
        rawHeaders: this.sanitizeHeaders(msg?.properties?.headers),
        payloadSnippet: msg?.content ? msg.content.toString('utf-8').substring(0, 512) : '',
      });
    } catch (saveError: any) {
      this.logger.error(`Fallo guardando incidente en clio.security_incidents: ${saveError.message}`);
    }
  }

  private sanitizeHeaders(headers: any): Record<string, string> {
    if (!headers) return {};
    const sanitized: Record<string, string> = {};
    for (const [key, val] of Object.entries(headers)) {
      if (key.toLowerCase() === 'authorization') {
        const strVal = String(val);
        sanitized[key] = strVal.length > 20 ? `${strVal.substring(0, 15)}...[MASKED]` : '[MASKED]';
      } else {
        sanitized[key] = String(val);
      }
    }
    return sanitized;
  }
}
