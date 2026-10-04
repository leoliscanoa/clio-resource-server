import { Injectable, Logger } from '@nestjs/common';
import { AuditEventDTO } from '@lliscano/node-rest-commons';
import { DynamicTenantCollectionResolver } from './dynamic-tenant-collection-resolver.service';

@Injectable()
export class AuditIngestionService {
  private readonly logger = new Logger(AuditIngestionService.name);

  constructor(private readonly collectionResolver: DynamicTenantCollectionResolver) {}

  async ingestEvent(event: AuditEventDTO): Promise<void> {
    if (!event || !event.tenantId) {
      throw new Error('Evento de auditoría inválido o sin tenantId');
    }

    const model = await this.collectionResolver.getModel(event.tenantId);

    const docToInsert = {
      eventId: event.eventId,
      correlationId: event.correlationId,
      tenantId: event.tenantId,
      projectId: event.projectId || null,
      serviceName: event.serviceName,
      entityName: event.entityName,
      entityId: event.entityId,
      action: event.action,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      actor: event.actor,
      diff: event.diff || null,
      previousState: event.previousState || null,
      currentState: event.currentState || null,
    };

    try {
      await model.collection.insertOne(docToInsert, {
        writeConcern: { w: 'majority', j: true },
      });
      this.logger.debug(
        `Evento ${event.eventId} persistido exitosamente en colección del tenant ${event.tenantId}`,
      );
    } catch (error: any) {
      if (error.code === 11000) {
        this.logger.warn(
          `Idempotencia: Evento ${event.eventId} ya persistido previamente. Se ignora duplicado.`,
        );
        return;
      }
      throw error;
    }
  }
}
