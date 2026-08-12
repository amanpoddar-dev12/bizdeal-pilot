import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePending } from "./components/route-pending";
import { applyQueryDefaults, shouldRetry, retryDelay } from "./lib/query-config";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays usable while it refreshes quietly in the background,
        // so CRUD and navigation never flash a loading screen.
        // Per-resource stale times are registered below via applyQueryDefaults.
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetry,
        retryDelay: (attempt) => retryDelay(attempt),
        placeholderData: (prev: unknown) => prev,
      },
    },
  });

  applyQueryDefaults(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 700,
    defaultPendingMinMs: 400,
    defaultPendingComponent: RoutePending,
  });


  return router;
};
