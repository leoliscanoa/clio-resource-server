import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityAuditTrail, EntityAuditTrailDocument } from '../schemas/entity-audit-trail.schema';
import { AuditEventDTO } from '@lliscano/node-rest-commons';

@Injectable()
export class EntityAuditTrailRepository {
  constructor(
    @InjectModel(EntityAuditTrail.name)
    private readonly auditModel: Model<EntityAuditTrailDocument>,
  ) {}

  async appendEventToTimeline(event: AuditEventDTO): Promise<void> {
    const eventDate = new Date(event.timestamp);

    await this.auditModel.updateOne(
      { _id: event.entityId },
      {
        $setOnInsert: {
          entityName: event.entityName,
          serviceName: event.serviceName,
          tenantId: event.tenantId,
          createdAt: eventDate,
        },
        $set: {
          lastModifiedAt: eventDate,
        },
        $inc: {
          totalEvents: 1,
        },
        $push: {
          events: {
            $each: [
              {
                eventId: event.eventId,
                correlationId: event.correlationId,
                action: event.action,
                timestamp: eventDate,
                actor: event.actor,
                diff: event.diff ?? null,
                previousState: event.previousState ?? null,
                currentState: event.currentState ?? null,
              },
            ],
            $sort: { timestamp: 1 },
          },
        },
      },
      { upsert: true },
    );
  }

  async findByEntityId(entityId: string): Promise<EntityAuditTrail | null> {
    return this.auditModel.findById(entityId).lean().exec() as unknown as Promise<EntityAuditTrail | null>;
  }
}
