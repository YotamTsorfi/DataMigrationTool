/**
 * Hook for global authentication checking and redirect handling.
 * Allows for displaying a login prompt when unauthenticated users try to use protected features.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";

export const useGlobalAuthCheck = () => {
  const { isAuthenticated } = useAuth();
  const [loginPromptShown, setLoginPromptShown] = useState(false);

  useEffect(() => {
    // Add global click handler to check for interactions with protected elements
    const clickHandler = (e: MouseEvent) => {
      if (isAuthenticated) return;

      const target = e.target as HTMLElement;
      const isProtectedElement = target.closest('[data-auth-protected="true"]');

      if (isProtectedElement && !loginPromptShown) {
        toast.info("Please log in to access this feature", {
          toastId: "login-prompt", // Prevents duplicate toasts
          autoClose: 3000,
        });
        setLoginPromptShown(true);
        setTimeout(() => setLoginPromptShown(false), 3000);

        // Stop event propagation to prevent default action
        e.stopPropagation();
        e.preventDefault();
      }
    };

    document.addEventListener("click", clickHandler, true); // true for capture phase

    return () => {
      document.removeEventListener("click", clickHandler, true);
    };
  }, [isAuthenticated, loginPromptShown]);

  // Additional auth-related global utilities can be added here

  return { isAuthenticated };
};
