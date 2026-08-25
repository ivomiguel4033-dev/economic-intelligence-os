export type ResourceAction = "read" | "write" | "delete" | "execute" | "admin";

export interface AuthorizationContext {
  organizationId: string;
  actorId: string;
  roles: string[];
  permissions: string[];
}

export interface ResourceDescriptor {
  organizationId: string;
  resourceType: string;
  resourceId?: string;
}

export function authorize(context: AuthorizationContext, resource: ResourceDescriptor, action: ResourceAction): boolean {
  if (context.organizationId !== resource.organizationId) return false;
  if (context.roles.includes("owner") || context.roles.includes("admin")) return true;
  return context.permissions.includes(`${resource.resourceType}:${action}`);
}

export function requireAuthorization(context: AuthorizationContext, resource: ResourceDescriptor, action: ResourceAction) {
  if (!authorize(context, resource, action)) throw new Error("Access denied by authorization policy");
}
