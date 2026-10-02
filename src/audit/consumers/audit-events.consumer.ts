import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import {
  AuditEventDTO,
  M2mSecurityEnvelopeValidator,
} from '@lliscano/node-rest-commons';
import { AuditIngestionService } from '../services/audit-ingestion.service';

const CLIO_EXCHANGE = process.env.RABBITMQ_AUDIT_EXCHANGE || 'clio.topic.exchange';
const CLIO_QUEUE = process.env.RABBITMQ_AUDIT_QUEUE || 'clio-events-queue';
const CLIO_ROUTING_KEY = process.env.RABBITMQ_AUDIT_ROUTING_KEY || 'clio.#';
const CLIO_DLX = process.env.RABBITMQ_AUDIT_DLX || 'x-clio-events-dlq';
const CLIO_DLQ_KEY = process.env.RABBITMQ_AUDIT_DLQ_KEY || 'clio-events-dlq-key';

@Injectable()
export class AuditEventsConsumer {
  private readonly logger = new Logger(AuditEventsConsumer.name);

  constructor(
    private readonly m2mValidator: M2mSecurityEnvelopeValidator,
    private readonly ingestionService: AuditIngestionService,
  ) {}

  @RabbitSubscribe({
    exchange: CLIO_EXCHANGE,
    routingKey: CLIO_ROUTING_KEY,
    queue: CLIO_QUEUE,
    queueOptions: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': CLIO_DLX,
        'x-dead-letter-routing-key': CLIO_DLQ_KEY,
      },
    },
  })
  public async handleAuditEvent(event: AuditEventDTO, rawMessage: ConsumeMessage): Promise<void> {
    const authHeader = (rawMessage?.properties?.headers?.['Authorization'] ||
      rawMessage?.properties?.headers?.['authorization']) as string;
    const originService = rawMessage?.properties?.headers?.['x-origin-service'] as string;

    this.logger.log(`AMQP_INGEST: Recibido evento [${event?.eventId}] desde servicio [${originService}]`);

    try {
      // 1. Validación de seguridad Zero Trust del sobre M2M
      await this.m2mValidator.validateAmqpToken(authHeader);

      // 2. Ingesta atómica anidada en MongoDB
      await this.ingestionService.ingestEvent(event);
      this.logger.debug(`AMQP_INGEST_SUCCESS: Evento [${event.eventId}] almacenado en timeline de [${event.entityId}]`);
    } catch (error: any) {
      this.logger.error(
        `AMQP_SECURITY_OR_INGEST_ERROR: Fallo al procesar evento [${event?.eventId}]. Redirigiendo a DLQ. Error: ${error.message}`,
      );
      // Al lanzar error, el consumidor NACKea y RabbitMQ redirige el mensaje a la DLQ configurada
      throw error;
    }
  }
}
