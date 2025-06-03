/**
 * Authentication status component that displays login status and login/logout buttons.
 * Shows a visual indicator of authentication status.
 */
import React, { useState } from "react";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import LoginModal from "../../src/LoginModal";

const AuthContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const StatusIndicator = styled.div<{ $isAuthenticated: boolean }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: ${(props) =>
    props.$isAuthenticated ? "#4caf50" : "#f44336"};
`;

const UserInfo = styled.div`
  font-size: 14px;
`;

const Username = styled.span`
  font-weight: bold;
  margin-left: 5px;
`;

const AuthButton = styled.button`
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: #0069d9;
  }
`;

const LogoutButton = styled(AuthButton)`
  background-color: #6c757d;

  &:hover {
    background-color: #5a6268;
  }
`;

const AuthStatus: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const handleLoginClick = () => {
    setIsLoginModalOpen(true);
  };

  const handleLogoutClick = () => {
    logout();
  };

  const handleCloseModal = () => {
    setIsLoginModalOpen(false);
  };

  return (
    <>
      <AuthContainer>
        <StatusIndicator $isAuthenticated={isAuthenticated} />
        {isAuthenticated ? (
          <>
            <UserInfo>
              Logged in as: <Username>{user?.username}</Username>
            </UserInfo>
            <LogoutButton onClick={handleLogoutClick}>Logout</LogoutButton>
          </>
        ) : (
          <>
            <UserInfo>Not logged in</UserInfo>
            <AuthButton onClick={handleLoginClick}>Login</AuthButton>
          </>
        )}
      </AuthContainer>
      <LoginModal isOpen={isLoginModalOpen} onClose={handleCloseModal} />
    </>
  );
};

export default AuthStatus;
