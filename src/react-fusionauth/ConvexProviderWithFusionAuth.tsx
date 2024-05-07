import { useFusionAuth } from "@fusionauth/react-sdk";
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
 * authenticated with FusionAuth.
 *
 * It must be wrapped by a configured `FusionAuthProvider` from `@fusionauth/react-sdk`.
 *
 * See [Convex FusionAuth](https://docs.convex.dev/auth/fusionauth) on how to set up
 * Convex with FusionAuth.
 *
 * @public
 */
export function ConvexProviderWithFusionAuth({
  children,
  client,
}: {
  children: ReactNode;
  client: IConvexReactClient;
}) {
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromFusionAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function useAuthFromFusionAuth() {
  const { isFetchingUserInfo, isLoggedIn } = useFusionAuth();
  const fetchAccessToken = useCallback(async () => {
    try {
      //Need solution for this part
      return "cookie has app.at in HttpOnly";
    } catch (error) {
      return null;
    }
  }, []);
  return useMemo(
    () => ({
      isLoading: !isFetchingUserInfo,
      isAuthenticated: isLoggedIn ?? false,
      fetchAccessToken,
    }),
    [isFetchingUserInfo, isLoggedIn, fetchAccessToken],
  );
}
