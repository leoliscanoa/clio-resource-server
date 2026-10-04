import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ActorDTO, FieldDiffDTO } from '@lliscano/node-rest-commons';

@Schema({ timestamps: false, versionKey: false })
export class AuditDocument {
  @Prop({ required: true, type: String })
  eventId: string;

  @Prop({ required: true, type: String })
  correlationId: string;

  @Prop({ required: true, type: String })
  tenantId: string;

  // Estrictamente opcional / nullable para compatibilidad 360° con Cerberos SSO y Hermes
  @Prop({ type: String, default: null })
  projectId?: string | null;

  @Prop({ required: true, type: String })
  serviceName: string;

  @Prop({ required: true, type: String })
  entityName: string;

  @Prop({ required: true, type: String })
  entityId: string;

  @Prop({ required: true, enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGICAL_DELETE'] })
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

export type AuditDocumentHydrated = HydratedDocument<AuditDocument>;
export const AuditDocumentSchema = SchemaFactory.createForClass(AuditDocument);

// Definición declarativa de índices compuestos
AuditDocumentSchema.index({ entityName: 1, entityId: 1, timestamp: -1 }, { name: 'ix_entity_history', background: true });
AuditDocumentSchema.index({ projectId: 1, timestamp: -1 }, { name: 'ix_rebac_project', sparse: true, background: true });
AuditDocumentSchema.index({ 'actor.username': 1, timestamp: -1 }, { name: 'ix_actor_history', background: true });
AuditDocumentSchema.index({ timestamp: -1 }, { name: 'ix_global_timeline', background: true });
AuditDocumentSchema.index({ eventId: 1 }, { name: 'uq_event_id', unique: true, background: true });
