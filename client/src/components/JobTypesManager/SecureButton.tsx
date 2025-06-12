/**
 * Secure button component for JobTypesManager with authentication protection.
 * Automatically disables if user is not authenticated.
 */
import React from "react";
import { withAuthProtection } from "../withAuthProtection";

interface SecureButtonProps {
  className?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const Button: React.FC<SecureButtonProps> = ({
  className,
  onClick,
  disabled,
  children,
  style,
}) => {
  return (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
};

const SecureButton = withAuthProtection(Button);

export default SecureButton;
