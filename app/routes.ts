import type { RouteConfig } from "@react-router/dev/routes";

// Keep the generated Agent-Native pages while declaring the domain routes
// directly. This avoids evaluating the CJS fs-routes helper in Vite's ESM
// route-config runner on Windows.
export default [
  { path: "landing", file: "routes/landing.tsx" },
  { path: "dashboard", file: "routes/dashboard.tsx" },
  { path: "home", file: "routes/home.tsx" },
  { path: "chat", file: "routes/chat._index.tsx" },
  { path: "chat/:threadId", file: "routes/chat.$threadId.tsx" },
  { path: "agent", file: "routes/agent.tsx" },
  { path: "database", file: "routes/database.tsx" },
  {
    path: "extensions",
    file: "routes/extensions.tsx",
    children: [
      { file: "routes/extensions._index.tsx", index: true },
      {
        path: ":id",
        file: "routes/extensions.$id.tsx",
        children: [{ path: ":slug", file: "routes/extensions.$id.$slug.tsx" }],
      },
    ],
  },
  { path: "observability", file: "routes/observability.tsx" },
  { path: "settings", file: "routes/settings.tsx" },
  { path: "settings/*", file: "routes/settings.$.tsx" },
  { path: "team", file: "routes/team.tsx" },
] satisfies RouteConfig;
