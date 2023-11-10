import { useKindeAuth } from "@kinde-oss/kinde-auth-react";
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
 * authenticated with Kinde.
 *
 * It must be wrapped by a configured `KindeProvider` from `@kinde-oss/kinde-auth-react`.
 *
 * @public
 */
export function ConvexProviderWithKinde({
  children,
  client,
}: {
  children: ReactNode;
  client: IConvexReactClient;
}) {
  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuthFromKinde}>
      {children}
    </ConvexProviderWithAuth>
  );
}

// Old Version
// export function useAuthFromKinde() {
//   const { isLoading, isAuthenticated, getToken } = useKindeAuth();
//   const fetchAccessToken = useCallback(
//     async () => {
//       // This might loop forever if `getToken` isn't memoized
//       return await getToken();
//     },
//     // If `getToken` isn't correctly memoized
//     // remove it from this dependency array
//     [getToken]
//   );
//   return useMemo(
//     () => ({
//       // Whether the auth provider is in a loading state
//       isLoading: isLoading,
//       // Whether the auth provider has the user signed in
//       isAuthenticated: isAuthenticated ?? false,
//       // The async function to fetch the ID token
//       fetchAccessToken,
//     }),
//     [isLoading, isAuthenticated, fetchAccessToken]
//   );
// }

// Better Version
function useAuthFromKinde() {
  const { isLoading, isAuthenticated, getToken } = useKindeAuth();
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (forceRefreshToken) {
        try {
          const response = await getToken();
          // Returns the token as string
          return response as string;
        } catch (error) {
          return null;
        }
      }
      // Add this line to ensure the function always returns a string or null
      return null;
    },
    [getToken]
  );
  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken]
  );
}
