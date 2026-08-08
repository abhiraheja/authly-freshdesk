import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthApi } from './auth.api';
import { homePathFor, type UserRole } from './auth.models';
import { SessionStore } from './session.store';

/**
 * Requires a signed-in user. Signed-out visitors go to /login carrying the URL
 * they wanted, so sign-in lands them where they were headed.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);

  const user = await session.ensureLoaded();
  if (user) return true;

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * Requires one of `roles`. Runs *after* {@link authGuard} on the same route tree,
 * so a user is always present here.
 *
 * A customer who lands on an agent URL is sent to their portal rather than being
 * shown an error — they are not doing anything wrong, they just followed a link
 * meant for staff.
 */
export function roleGuard(...roles: UserRole[]): CanActivateFn {
  return async () => {
    const session = inject(SessionStore);
    const router = inject(Router);

    const user = await session.ensureLoaded();
    if (!user) return router.createUrlTree(['/login']);
    if (roles.includes(user.role)) return true;

    return router.createUrlTree([homePathFor(user)]);
  };
}

/**
 * Keeps a signed-in user off the auth screens — hitting /login while already
 * signed in should land on your home, not ask you to sign in again.
 */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);

  const user = await session.ensureLoaded();
  if (user) return router.createUrlTree([homePathFor(user)]);

  // A brand-new install has nothing to sign in to yet. Sending them to /setup
  // beats a sign-in form that can only ever fail.
  return (await inject(AuthApi).needsSetup()) ? router.createUrlTree(['/setup']) : true;
};

/**
 * Guards /setup itself: it exists only until the installation is claimed.
 *
 * The check is the API's, not a local flag — the whole point is that a second
 * person cannot reach this screen, and only the database knows whether the
 * first one has already been through it.
 */
export const setupGuard: CanActivateFn = async () => {
  const router = inject(Router);
  if (await inject(AuthApi).needsSetup()) return true;
  return router.createUrlTree(['/login']);
};
