import { Injectable, Logger } from '@nestjs/common';
import { Connection, Model } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import {
  AuditDocument,
  AuditDocumentSchema,
} from '../schemas/audit-document.schema';

@Injectable()
export class DynamicTenantCollectionResolver {
  private readonly logger = new Logger(DynamicTenantCollectionResolver.name);
  private readonly provisionedCollections = new Set<string>();
  private readonly inFlightCreation = new Map<string, Promise<void>>();

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Resuelve y valida el nombre físico de la colección para el inquilino especificado.
   */
  public resolveCollectionName(tenantId: string): string {
    if (!tenantId || !/^[a-zA-Z0-9-]+$/.test(tenantId)) {
      throw new Error(`Identificador de tenant inválido o no sanitizado: ${tenantId}`);
    }
    return `audit_trail_${tenantId.toLowerCase()}`;
  }

  /**
   * Garantiza de forma idempotente que la colección y sus índices compuestos existan en el clúster.
   */
  public async ensureTenantCollection(tenantId: string): Promise<string> {
    const collectionName = this.resolveCollectionName(tenantId);

    // 1. Verificación en caché local rápida O(1)
    if (this.provisionedCollections.has(collectionName)) {
      return collectionName;
    }

    // 2. Control de concurrencia: si ya se está creando en paralelo, esperar la promesa existente
    if (this.inFlightCreation.has(collectionName)) {
      await this.inFlightCreation.get(collectionName);
      return collectionName;
    }

    // 3. Crear promesa de inicialización
    const initPromise = (async () => {
      try {
        if (!this.connection.db) {
          throw new Error('Conexión a MongoDB no inicializada');
        }
        const collections = await this.connection.db
          .listCollections({ name: collectionName })
          .toArray();

        if (collections.length === 0) {
          this.logger.log(`Aprovisionando perezosamente colección de auditoría: ${collectionName}`);
          await this.connection.db.createCollection(collectionName);

          const collection = this.connection.db.collection(collectionName);

          // Creación mandatoria de los índices compuestos de alto rendimiento + idempotencia
          await collection.createIndexes([
            {
              key: { entityName: 1, entityId: 1, timestamp: -1 },
              name: 'ix_entity_history',
              background: true,
            },
            {
              // Índice SPARSE: omite documentos con projectId: null (Cerberos SSO, Hermes, etc.)
              key: { projectId: 1, timestamp: -1 },
              name: 'ix_rebac_project',
              sparse: true,
              background: true,
            },
            {
              key: { 'actor.username': 1, timestamp: -1 },
              name: 'ix_actor_history',
              background: true,
            },
            {
              key: { timestamp: -1 },
              name: 'ix_global_timeline',
              background: true,
            },
            {
              key: { eventId: 1 },
              name: 'uq_event_id',
              unique: true,
              background: true,
            },
          ]);
          this.logger.log(`Índices compuestos generados exitosamente para ${collectionName}`);
        }
        this.provisionedCollections.add(collectionName);
      } finally {
        this.inFlightCreation.delete(collectionName);
      }
    })();

    this.inFlightCreation.set(collectionName, initPromise);
    await initPromise;
    return collectionName;
  }

  /**
   * Retorna el modelo de Mongoose dinámicamente vinculado a la colección del tenant.
   */
  public async getModel(tenantId: string): Promise<Model<AuditDocument>> {
    const collectionName = await this.ensureTenantCollection(tenantId);
    if (this.connection.models[collectionName]) {
      return this.connection.models[collectionName] as Model<AuditDocument>;
    }
    return this.connection.model<AuditDocument>(
      collectionName,
      AuditDocumentSchema,
      collectionName,
    );
  }

  /**
   * Elimina atómicamente la colección del inquilino (Purga de Tenant).
   */
  public async dropTenantCollection(
    tenantId: string,
  ): Promise<{ executionTimeMs: number; droppedCollection: string }> {
    const collectionName = this.resolveCollectionName(tenantId);
    const startTime = Date.now();

    try {
      if (this.connection.db) {
        await this.connection.db.collection(collectionName).drop();
      }
    } catch (error: any) {
      // Si la colección no existía, ignoramos el error específico de MongoDB
      if (error.codeName !== 'NamespaceNotFound' && !error.message?.includes('ns not found')) {
        throw error;
      }
    }

    this.provisionedCollections.delete(collectionName);
    try {
      this.connection.deleteModel(collectionName);
    } catch (_) {
      // Si el modelo no estaba registrado, ignorar
    }

    const executionTimeMs = Date.now() - startTime;
    this.logger.log(`Colección ${collectionName} purgada atómicamente en ${executionTimeMs}ms`);
    return { executionTimeMs, droppedCollection: collectionName };
  }

  public evictCollectionCache(tenantId: string): void {
    const collectionName = this.resolveCollectionName(tenantId);
    this.provisionedCollections.delete(collectionName);
  }
}
