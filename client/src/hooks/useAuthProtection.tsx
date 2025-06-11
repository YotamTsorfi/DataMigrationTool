/**
 * Custom hook that provides authentication protection for components
 * Returns auth status and helper functions to protect UI elements
 */
import { useAuth } from "../context/AuthContext";
import { useGlobalAuthCheck } from "./useGlobalAuthCheck";

/**
 * Hook for protecting components that require authentication
 * @returns Object containing authentication state and helper functions
 */
export const useAuthProtection = () => {
  const { isAuthenticated } = useAuth();
  useGlobalAuthCheck(); // Use the global auth check for additional protection

  // Helper function to add protection attribute to props
  const protectProps = (
    baseProps: Record<string, any> = {}
  ): Record<string, any> => {
    return {
      ...baseProps,
      "data-auth-protected": "true",
      disabled: !isAuthenticated,
    };
  };

  return {
    isAuthenticated,
    protectProps,
  };
};
