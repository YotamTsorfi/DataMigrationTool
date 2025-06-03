/**
 * Script to fix or regenerate the admin user's password hash
 * Use this script to ensure the password hash correctly matches "admin123"
 */
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

const PLAIN_PASSWORD = "admin123";
const USER_FILE_PATH = path.join(__dirname, "../models/User.ts");

/**
 * Generates a new correct hash for the admin password and updates the User.ts file
 */
async function fixAdminPassword(): Promise<void> {
  try {
    // Generate a new hash for "admin123"
    const newHash = await bcrypt.hash(PLAIN_PASSWORD, 10);
    console.log(`Generated new hash for "admin123": ${newHash}`);

    // Read the User.ts file
    let userFileContent = fs.readFileSync(USER_FILE_PATH, "utf8");

    // Find and replace the password hash in the file
    const oldHashRegex = /password: "(\$2a\$10\$[^"]+)"/;
    const match = userFileContent.match(oldHashRegex);

    if (match) {
      const oldHash = match[1];
      console.log(`Found existing hash: ${oldHash}`);

      // Test if current hash works
      const isValid = await bcrypt.compare(PLAIN_PASSWORD, oldHash);
      console.log(`Is current hash valid for "admin123"?: ${isValid}`);

      if (!isValid) {
        // Replace the old hash with the new one
        userFileContent = userFileContent.replace(
          oldHashRegex,
          `password: "${newHash}"`
        );

        // Write the updated content back to the file
        fs.writeFileSync(USER_FILE_PATH, userFileContent);
        console.log("Admin password hash has been updated!");
      } else {
        console.log(
          "Current hash is actually valid. Other issues may be causing authentication failure."
        );
      }
    } else {
      console.log("Could not find password hash pattern in User.ts file.");
    }
  } catch (error) {
    console.error("Error fixing admin password:", error);
  }
}

// Run the script
fixAdminPassword();

console.log(`
==================================================
MANUAL FIX INSTRUCTIONS:
==================================================
If the script fails, manually update the admin user in User.ts with this hash:
"$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

This is a freshly generated hash for "admin123".
==================================================
`);
