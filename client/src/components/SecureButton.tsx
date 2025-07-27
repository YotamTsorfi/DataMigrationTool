/**
 * Button component with authentication protection.
 * Automatically disables if user is not authenticated.
 */
import { Button } from "./BatchProcessorStyles";
import { withAuthProtection } from "./withAuthProtection";

// Create a secure version of the existing button
const SecureButton = withAuthProtection(Button);

export default SecureButton;
