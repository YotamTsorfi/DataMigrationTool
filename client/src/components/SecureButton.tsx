/**
 * Button component with authentication protection.
 * Automatically disables if user is not authenticated.
 */
import React from "react";
import { Button } from "./BatchProcessorStyles";
import { withAuthProtection } from "./withAuthProtection";

// יצירת גרסה מאובטחת של הכפתור הקיים
const SecureButton = withAuthProtection(Button);

export default SecureButton;
