/**
 * User model for authentication with role-based access control.
 * Handles user data structure and password validation.
 */
import bcrypt from "bcryptjs";

export interface User {
  id: string;
  username: string;
  password: string;
  isAdmin: boolean;
  lastLogin?: Date;
}

export class UserService {
  private static users: User[] = [
    {
      id: "1",
      username: "admin",
      // Hashed version of "admin123"
      password: "$2b$10$vJFN/rL2Yj.CsOrj8TyClucVwTH7ZYLpTSV04mchE9.Fpou6db3TO",
      isAdmin: true,
    },
  ];

  /**
   * Verifies if a plaintext password matches a stored hash
   * @param plainPassword The plaintext password to check
   * @param storedHash The stored bcrypt hash to verify against
   * @returns A Promise resolving to a boolean indicating if the password matches
   */
  verifyPassword = async (
    plainPassword: string,
    storedHash: string
  ): Promise<boolean> => {
    try {
      const result = await bcrypt.compare(plainPassword, storedHash);
      console.log(`Hash verification result: ${result}`);
      return result;
    } catch (err) {
      console.error("Error during password verification:", err);
      return false;
    }
  };

  /**
   * Generates a new bcrypt hash for a plaintext password
   * @param plainPassword The plaintext password to hash
   * @param saltRounds The number of salt rounds to use (default: 10)
   * @returns A Promise resolving to the generated hash
   */
  generateHash = async (
    plainPassword: string,
    saltRounds = 10
  ): Promise<string> => {
    try {
      const hash = await bcrypt.hash(plainPassword, saltRounds);
      console.log(`Generated hash for testing: ${hash}`);
      return hash;
    } catch (err) {
      console.error("Error generating password hash:", err);
      throw err;
    }
  };

  /**
   * Validates user credentials and returns user if valid
   */
  static async validateUser(
    username: string,
    password: string
  ): Promise<User | null> {
    console.log(`Attempting to validate user: ${username}`);
    const user = this.users.find((u) => u.username === username);

    if (!user) {
      console.log(`User ${username} not found`);
      return null;
    }

    console.log(`User found, validating password...`);
    try {
      // Log password length to check for whitespace issues
      console.log(`Password length: ${password.length}`);

      const isPasswordValid = await bcrypt.compare(password, user.password);

      console.log(`bcrypt.compare result: ${isPasswordValid}`);

      if (!isPasswordValid) {
        console.log(`Password validation failed for user: ${username}`);
        return null;
      }

      console.log(`Login successful for user: ${username}`);
      return { ...user, password: "" }; // Don't return the password
    } catch (error) {
      console.error("Error during password validation:", error);
      return null;
    }
  }

  /**
   * Gets a user by username
   */
  static getUserByUsername(username: string): User | undefined {
    return this.users.find((u) => u.username === username);
  }

  /**
   * Updates the last login time for a user
   */
  static updateLastLogin(username: string): void {
    const userIndex = this.users.findIndex((u) => u.username === username);
    if (userIndex !== -1) {
      this.users[userIndex].lastLogin = new Date();
    }
  }
}
