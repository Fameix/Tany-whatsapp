import "server-only";

const production = process.env.NODE_ENV === "production";
// The signed development session is safe to retain across ordinary Next dev
// restarts because it remains HttpOnly and can only be verified with the
// unchanged server-side secret in .env.local.
const maxAge = production ? 60 * 60 : 7 * 24 * 60 * 60;

// __Host- cookies require Secure, Path=/, and no Domain. Local HTTP development
// uses a distinct name because browsers cannot reliably retain Secure cookies there.
export const dashboardSessionCookieName = production
  ? "__Host-tany-dashboard"
  : "tany-dashboard-dev";

export const dashboardSessionCookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
};
