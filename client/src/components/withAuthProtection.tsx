/**
 * Higher-order component for protecting components that require authentication.
 * Controls access to interactive elements based on authentication status.
 */
import React from "react";
import { useAuth } from "../context/AuthContext";

interface WithAuthProtectionProps {
  isProtected?: boolean;
  disableIfUnauthenticated?: boolean;
}

export const withAuthProtection = <P extends object>(
  Component: React.ComponentType<P>
) => {
  return function ProtectedComponent({
    isProtected = true,
    disableIfUnauthenticated = true,
    ...props
  }: P & WithAuthProtectionProps) {
    const { isAuthenticated } = useAuth();

    // If the component isn't protected, or user is authenticated, render normally
    if (!isProtected || isAuthenticated) {
      return <Component {...(props as P)} />;
    }

    // If component should be disabled for unauthenticated users
    if (disableIfUnauthenticated) {
      return <Component {...(props as P)} disabled={true} />;
    }

    // Otherwise, don't render the component
    return null;
  };
};

// Special hook for controls that need authentication
export const useAuthProtection = () => {
  const { isAuthenticated } = useAuth();

  return {
    isAuthenticated,
    disabled: !isAuthenticated,
  };
};
