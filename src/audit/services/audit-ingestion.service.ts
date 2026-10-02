import { Injectable, Logger } from '@nestjs/common';
import { EntityAuditTrailRepository } from '../repositories/entity-audit-trail.repository';
import { AuditEventDTO } from '@lliscano/node-rest-commons';

@Injectable()
export class AuditIngestionService {
  private readonly logger = new Logger(AuditIngestionService.name);

  constructor(private readonly repository: EntityAuditTrailRepository) {}

  async ingestEvent(event: AuditEventDTO): Promise<void> {
    if (!event || !event.entityId) {
      throw new Error('Evento de auditoría inválido o sin entityId');
    }
    this.logger.debug(`Ingestando evento [${event.eventId}] para entidad [${event.entityId}]`);
    await this.repository.appendEventToTimeline(event);
  }
}
