/**
 * Authentication context for managing user authentication state.
 * Provides login, logout functionality and access to authentication status.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import axios from "axios";

interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => false,
  logout: () => {},
  error: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing token and verify it
    const checkAuth = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/auth/verify`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.data.success) {
          setUser(response.data.user);
        } else {
          // Invalid token
          localStorage.removeItem("authToken");
        }
      } catch (err) {
        console.error("Auth verification error:", err);
        localStorage.removeItem("authToken");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (
    username: string,
    password: string
  ): Promise<boolean> => {
    setError(null);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/auth/login`,
        { username, password }
      );

      if (response.data.success) {
        localStorage.setItem("authToken", response.data.token);
        setUser(response.data.user);
        return true;
      } else {
        setError(response.data.message || "Authentication failed");
        return false;
      }
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.message || err.message || "Authentication failed";
      setError(errorMessage);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("authToken");
    setUser(null);

    // Optional: Call the server to invalidate the token
    axios
      .post(`${process.env.REACT_APP_API_URL}/auth/logout`)
      .catch((err) => console.error("Logout error:", err));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
