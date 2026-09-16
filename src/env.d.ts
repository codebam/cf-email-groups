/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts on every request. */
    user: import('./lib/types').SessionUser | null;
  }
}
