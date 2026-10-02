import { Injectable } from '@nestjs/common';
import { EntityAuditTrailRepository } from '../repositories/entity-audit-trail.repository';
import { EntityAuditTrail } from '../schemas/entity-audit-trail.schema';

@Injectable()
export class AuditQueryService {
  constructor(private readonly repository: EntityAuditTrailRepository) {}

  async findTimelineByEntityId(entityId: string): Promise<EntityAuditTrail | null> {
    return this.repository.findByEntityId(entityId);
  }
}
