import { Injectable, ForbiddenException, Logger } from '@nestjs/common';

export interface UserSecurityContext {
  userUuid: string;
  username: string;
  tenantId: string;
  roles: string[]; // Roles globales y de cliente en Cerberos SSO
}

@Injectable()
export class RebacAuditAuthorizer {
  private readonly logger = new Logger(RebacAuditAuthorizer.name);

  /**
   * Valida los alcances de consulta según la jerarquía EIA ADMIN vs. PROJECT_LEAD
   * y garantiza compatibilidad 360° con entidades sin proyecto (Cerberos SSO, Hermes).
   */
  public async enforceRebacAccess(
    context: UserSecurityContext,
    targetServiceName: string,
    targetProjectId?: string | null,
  ): Promise<{ isSuperAdmin: boolean; allowedProjectIds: string[] }> {
    // 1. Superadministrador global: potestad irrestricta en todo el tenant
    if (context.roles?.includes('SUPERADMIN') || context.roles?.includes('ROLE_SUPERADMIN')) {
      return { isSuperAdmin: true, allowedProjectIds: [] };
    }

    // CASO A: Entidad sin contexto de proyecto (projectId == null)
    // Aplica para cerbos-resource-server (User, AppClient), hermes-resource-server y catálogos globales
    if (!targetProjectId) {
      if (targetServiceName === 'cerbos-resource-server') {
        const hasCerbosAdmin =
          context.roles?.includes('ADMIN') ||
          context.roles?.includes('ROLE_ADMIN') ||
          context.roles?.includes('CERBOS_ADMIN');
        if (!hasCerbosAdmin) {
          this.logger.warn(`Usuario ${context.username} intentó auditar identidad Cerberos sin rol ADMIN.`);
          throw new ForbiddenException(
            'Acceso denegado: Se requiere rol administrativo para auditar identidades.',
          );
        }
        return { isSuperAdmin: true, allowedProjectIds: [] };
      }

      // Para otros microservicios sin proyecto, validar que posea rol administrativo del servicio
      const hasServiceAdmin = context.roles?.some(
        (r) => r.endsWith('_ADMIN') || r === 'ADMIN' || r === 'ROLE_ADMIN',
      );
      if (!hasServiceAdmin) {
        throw new ForbiddenException(
          `Acceso denegado: No posee privilegios para auditar el servicio ${targetServiceName}.`,
        );
      }
      return { isSuperAdmin: true, allowedProjectIds: [] };
    }

    // CASO B: Entidad con contexto de proyecto (projectId != null)
    // Aplica para proyectos, actores y compromisos en eia-java-resource-server
    const hasProjectsRole = context.roles?.some((r) => r === 'PROJECTS' || r === 'ROLE_PROJECTS');
    if (!hasProjectsRole) {
      throw new ForbiddenException('El usuario no posee permisos para acceder al módulo de proyectos.');
    }

    const eiaProfile = await this.fetchEiaUserProfile(context.userUuid, context.tenantId);

    // B.1. Superadministrador dentro de EIA Core (ADMIN en eia.project_role)
    if (eiaProfile.isEiaAdmin) {
      return { isSuperAdmin: true, allowedProjectIds: [] };
    }

    // B.2. Líder de Proyecto (PROJECT_LEAD) o Miembro Operativo -> Modo Solo Lectura Acotado
    const assignedProjectIds = eiaProfile.assignedProjectIds || [];

    if (!assignedProjectIds.includes(targetProjectId)) {
      this.logger.warn(
        `Acceso ReBAC denegado para usuario ${context.username} a proyecto ajeno ${targetProjectId}`,
      );
      throw new ForbiddenException(
        'Acceso denegado: No posee membresía en el proyecto asociado a esta entidad.',
      );
    }

    return { isSuperAdmin: false, allowedProjectIds: assignedProjectIds };
  }

  public async fetchEiaUserProfile(
    userUuid: string,
    tenantId: string,
  ): Promise<{ isEiaAdmin: boolean; assignedProjectIds: string[] }> {
    const eiaUrl = process.env.EIA_API_URL || 'http://eia-java-resource-server:8080';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      timeoutId.unref?.();

      const response = await fetch(`${eiaUrl}/internal/v1/users/${userUuid}/eia-rbac`, {
        method: 'GET',
        headers: {
          'X-Tenant-ID': tenantId,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          `Consulta ReBAC a EIA retornó status ${response.status} para usuario ${userUuid}`,
        );
        return { isEiaAdmin: false, assignedProjectIds: [] };
      }

      const body: any = await response.json();
      return body?.data || { isEiaAdmin: false, assignedProjectIds: [] };
    } catch (error: any) {
      this.logger.error(`Fallo consultando membresías ReBAC en EIA: ${error.message}`);
      return { isEiaAdmin: false, assignedProjectIds: [] };
    }
  }
}
