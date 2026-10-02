/**
 * Host half of the Pudding pet bundle.
 *
 * The pet itself is rendered entirely in the browser: it reads assistant text
 * from the client-side session event stream and speaks through the Web Speech
 * API. Every feature therefore works without a host route, so editing
 * `lib/client.js` needs only a page refresh (no DSH restart).
 *
 * This module exists to make the package a real bundle: a package without
 * `dsh.bundle.patch` never joins the bundle stack. It holds no state, registers
 * no routes, and makes no network requests.
 *
 * Why there is no `Config` here
 * -----------------------------
 * Cordis validates a plugin's `Config` as a Standard Schema
 * (`Config['~standard'].validate`). A plain JSON-Schema object is therefore not
 * accepted and fails activation with:
 *
 *   TypeError: Cannot read properties of undefined (reading 'validate')
 *
 * The correct shape comes from `@deepseek-ai/schemastery`, which would add a
 * dependency for no benefit: this plugin has nothing to configure. Turning the
 * whole row off is already possible at the loader level, e.g. in a profile
 * patch:
 *
 *   - id: pudding-pet
 *     disabled: true
 *
 * So the host half stays dependency-free on purpose.
 */

export const name = 'puddingPet';

export function apply(ctx) {
  ctx.logger?.debug?.('pudding-pet: host half active (rendering lives in the client)');
}
