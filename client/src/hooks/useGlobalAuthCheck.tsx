/**
 * Hook for global authentication checking with synchronized state to prevent false negatives
 * after page refreshes.
 */
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useAuthSync } from "./useAuthSync";

export const useGlobalAuthCheck = () => {
  const { isAuthenticated, isInitialized, user } = useAuthSync();
  const [loginPromptShown, setLoginPromptShown] = useState(false);

  // // Log authentication state on mount and when it changes
  // useEffect(() => {
  //   console.log("Auth state updated (synchronized):", {
  //     isAuthenticated,
  //     user,
  //     isInitialized,
  //   });
  // }, [isAuthenticated, user, isInitialized]);

  useEffect(() => {
    // Only add the click handler if auth sync is initialized
    if (!isInitialized) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isProtectedElement = target.closest('[data-auth-protected="true"]');

      if (isProtectedElement) {
        console.log("Protected element clicked, auth state:", {
          isAuthenticated,
          username: user?.username,
          isInitialized,
        });

        // Only block if not authenticated
        if (!isAuthenticated && !loginPromptShown) {
          console.log("Blocking action - user not authenticated");
          toast.info("Please log in to access this feature", {
            toastId: "login-prompt",
            autoClose: 3000,
          });
          setLoginPromptShown(true);
          setTimeout(() => setLoginPromptShown(false), 3000);

          // Stop event propagation to prevent default action
          e.stopPropagation();
          e.preventDefault();
        }
      }
    };

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, [isAuthenticated, loginPromptShown, user, isInitialized]);

  return { isAuthenticated };
};
