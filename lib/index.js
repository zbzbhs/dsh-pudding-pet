/**
 * Host half of the Pudding pet bundle.
 *
 * The pet itself is rendered entirely in the browser: it reads assistant text
 * from the client-side session event stream and speaks through the Web Speech
 * API. That keeps every feature reachable without a host route, so a change to
 * `lib/client.js` only needs a page refresh (no DSH restart).
 *
 * This module therefore only exists to make the package a real bundle (a
 * package without `dsh.bundle.patch` never joins the bundle stack). It holds no
 * state, registers nothing, and makes no network requests.
 */

export const name = 'puddingPet';

/** Read the row's config so a profile can switch the whole bundle off. */
export const Config = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
      description: 'Enable the Pudding desktop pet for every session in this profile.',
    },
  },
  additionalProperties: false,
};

export function apply(ctx, config) {
  const enabled = config?.enabled !== false;
  if (!enabled) {
    ctx.logger?.info?.('pudding-pet: disabled by profile config');
    return;
  }
  ctx.logger?.debug?.('pudding-pet: host half active (rendering lives in the client)');
}
