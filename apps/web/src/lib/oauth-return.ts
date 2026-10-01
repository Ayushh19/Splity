/**
 * Google's authorized redirect URI is the app root (GOOGLE_REDIRECT_URI), so Google sends the
 * browser to `/?state=…&code=…` (or `&error=…` if the user cancelled). Hand that straight to
 * Better Auth's callback, which validates `state`, exchanges the code and sets the session.
 *
 * Returns true when the browser is being redirected and the app should not render.
 */
export function forwardOAuthReturn(): boolean {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (pathname !== '/' || !params.has('state') || !(params.has('code') || params.has('error'))) return false;

  window.location.replace(`/api/auth/callback/google${search}`);
  return true;
}
