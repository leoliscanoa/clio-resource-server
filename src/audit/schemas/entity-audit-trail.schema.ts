import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ActorDTO, FieldDiffDTO } from '@lliscano/node-rest-commons';

@Schema({ _id: false })
export class AuditEventEntry {
  @Prop({ required: true })
  eventId: string;

  @Prop({ required: true })
  correlationId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true, type: Object })
  actor: ActorDTO;

  @Prop({ type: Object, default: null })
  diff?: Record<string, FieldDiffDTO>;

  @Prop({ type: Object, default: null })
  previousState?: Record<string, any>;

  @Prop({ type: Object, default: null })
  currentState?: Record<string, any>;
}

export const AuditEventEntrySchema = SchemaFactory.createForClass(AuditEventEntry);

@Schema({ collection: 'entity_audit_trail', timestamps: false })
export class EntityAuditTrail {
  @Prop({ required: true, type: String })
  _id: string; // Identificador unívoco de la entidad de negocio (ej. UUID)

  @Prop({ required: true })
  entityName: string;

  @Prop({ required: true })
  serviceName: string;

  @Prop({ required: true })
  tenantId: string;

  @Prop({ required: true, type: Date })
  createdAt: Date;

  @Prop({ required: true, type: Date })
  lastModifiedAt: Date;

  @Prop({ required: true, default: 1 })
  totalEvents: number;

  @Prop({ type: [AuditEventEntrySchema], default: [] })
  events: AuditEventEntry[];
}

export type EntityAuditTrailDocument = HydratedDocument<EntityAuditTrail>;
export const EntityAuditTrailSchema = SchemaFactory.createForClass(EntityAuditTrail);

// Índices secundarios para consultas eficientes
EntityAuditTrailSchema.index({ tenantId: 1, entityName: 1, lastModifiedAt: -1 }, { background: true });
EntityAuditTrailSchema.index({ 'events.actor.userUuid': 1, 'events.timestamp': -1 }, { background: true });
EntityAuditTrailSchema.index({ 'events.correlationId': 1 }, { background: true });
