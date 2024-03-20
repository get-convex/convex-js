import { useSession, useDescope, getSessionToken } from "@descope/react-sdk";
import React from "react";

import { ReactNode, useCallback, useMemo } from "react";
import { AuthTokenFetcher } from "../browser/sync/client.js";
import { ConvexProviderWithAuth } from "../react/ConvexAuthState.js";

// Until we can import from our own entry points (requires TypeScript 4.7),
// just describe the interface enough to help users pass the right type.
type IConvexReactClient = {
  setAuth(fetchToken: AuthTokenFetcher): void;
  clearAuth(): void;
};

/**
 * A wrapper React component which provides a {@link react.ConvexReactClient}
 * authenticated with Auth0.
 *
 * It must be wrapped by a configured `AuthProvider` from `@descope/reack-sdk`.
 *
 * See [Convex Descope](https://docs.convex.dev/auth/descope) on how to set up
 * Convex with Descope.
 *
 * @public
 */
export function ConvexProviderWithDescope({
  children,
  client,
}: {
  children: ReactNode;
  client: IConvexReactClient;
}) {
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromDescope}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function useAuthFromDescope() {
  const { isLoading, isAuthenticated } = useSession();
  const sdk = useDescope();
  
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    try {
      if (forceRefreshToken) {
        sdk.refresh();
      }
      
      const token = getSessionToken();
      return token as string;
    } catch (error) {
      return null;
    }
  }, []);

  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken],
  );
}
