// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  vite: {
    // Astro/Vite must not answer CORS preflights for us in dev: /api/public/subscribe
    // owns its origin policy (ALLOWED_SIGNUP_ORIGINS), matching production Workers.
    server: { cors: false },
    // Avoid loading two copies of Preact (components + SSR renderer) in workerd.
    resolve: {
      dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
    },
    // Work around cold-start races in the Cloudflare SSR dep optimizer:
    // pre-declare modules it would otherwise discover mid-startup and reload on.
    // See withastro/astro#17788 and #17893.
    optimizeDeps: {
      include: ['astro/assets/services/noop', 'astro/logger/json', 'astro/logger/console', 'preact/devtools'],
    },
    ssr: {
      optimizeDeps: {
        include: ['astro/app/manifest', '@astrojs/cloudflare/cache/provider', '@astrojs/preact/server.js'],
      },
    },
  },
  integrations: [preact()],
  // Astro's built-in CSRF check rejects form-encoded POSTs without an Origin
  // header. RFC 8058 one-click unsubscribe and provider webhooks are exactly
  // that, so we disable it and rely on SameSite=Lax + our own Origin check in
  // src/middleware.ts for browser requests.
  security: { checkOrigin: false },
  // We manage our own cookie sessions in D1, so skip Astro's KV-backed sessions.
  session: false,
});
