/**
 * Custom hook that ensures authentication state is properly synchronized after page refreshes.
 * Prevents false negative authentication states during the token verification process.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

export const useAuthSync = (): {
  isAuthenticated: boolean;
  isInitialized: boolean;
  user: any;
} => {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  const [syncedAuthState, setSyncedAuthState] =
    useState<boolean>(isAuthenticated);

  useEffect(() => {
    // If auth context is still loading, wait for it
    if (!isLoading) {
      // Auth context has completed initial loading
      setSyncedAuthState(isAuthenticated);
      setIsInitialized(true);

      // Store user data in session storage for quick access
      if (user) {
        sessionStorage.setItem("user", JSON.stringify(user));
      } else {
        sessionStorage.removeItem("user");
      }
    }
  }, [isAuthenticated, isLoading, user]);

  // On mount, check if we have a token but auth isn't ready yet
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    const sessionUser = sessionStorage.getItem("user");

    // If we have both token and session user but context says not authenticated,
    // this likely means we're in that initialization gap
    if (token && sessionUser && !isAuthenticated && isLoading) {
      console.log(
        "Using cached authentication state while waiting for verification"
      );
      setSyncedAuthState(true);
    }
  }, [isAuthenticated, isLoading]);

  return {
    isAuthenticated: syncedAuthState,
    isInitialized,
    user,
  };
};
