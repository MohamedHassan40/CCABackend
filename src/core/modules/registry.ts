import type { ModuleManifest } from '@cloud-org/shared';
import { Router } from 'express';

export type ModuleRegistration = {
  key: string;
  manifest: ModuleManifest;
  registerRoutes: (router: Router) => void;
};

class ModuleRegistry {
  private modules: Map<string, ModuleRegistration> = new Map();

  register(registration: ModuleRegistration): void {
    this.modules.set(registration.key, registration);
  }

  get(key: string): ModuleRegistration | undefined {
    return this.modules.get(key);
  }

  getAll(): ModuleRegistration[] {
    return Array.from(this.modules.values());
  }

  getManifests(): ModuleManifest[] {
    return this.getAll().map((m) => m.manifest);
  }
}

export const moduleRegistry = new ModuleRegistry();
















