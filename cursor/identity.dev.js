// Runtime module for cursor/identity.ts, which imports "./identity.dev.js".
// Keep this object identical to cursor/identity.dev.ts. Turbopack loads this
// file; the TypeScript sibling is the one the identity tool asks you to edit.
export const DEV_VIEWER = {
  sub: "user:dev",
  email: "dev@example.com",
  name: "Dev Viewer",
  teamId: 1,
  teamRole: "admin",
};
