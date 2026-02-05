// Shared types - kept in sync between cca_backend and cca_frontend
export type SidebarItem = {
  path: string;
  label: string;
  permission?: string;
  showIfModuleExpired?: boolean;
};

export type DashboardWidget = {
  id: string;
  title: string;
  description?: string;
  apiPath: string;
  permission?: string;
};

export type ModuleManifest = {
  key: string;
  name: string;
  icon?: string;
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
};

export type JWTPayload = {
  sub: string;
  email: string;
  orgId: string | null;
  isSuperAdmin: boolean;
  roleKeys: string[];
  permissionKeys: string[];
};

export type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
  };
  currentOrganization: {
    id: string;
    name: string;
    slug: string;
    expiresAt?: string | null;
    isOrgExpired?: boolean;
  } | null;
  memberships: Array<{
    id: string;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
    roles: Array<{
      id: string;
      key: string;
      name: string;
    }>;
  }>;
  roles: Array<{
    id: string;
    key: string;
    name: string;
  }>;
  permissions: Array<{
    id: string;
    key: string;
    name: string;
  }>;
  enabledModules: Array<{
    moduleKey: string;
    moduleName: string;
    isEnabled: boolean;
    plan: string | null;
    seats: number | null;
    expiresAt: Date | null;
    trialEndsAt: Date | null;
    isExpired: boolean;
    isTrial: boolean;
  }>;
};

export type ModuleManifestResponse = {
  key: string;
  name: string;
  icon?: string;
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  licensing: {
    isEnabled: boolean;
    plan: string | null;
    seats: number | null;
    expiresAt: Date | null;
    trialEndsAt: Date | null;
    isExpired: boolean;
    isTrial: boolean;
  };
};
