import { DatabaseService } from "../services/databaseService";

interface SystemConfig {
  CONCURRENT_BATCHES: number;
  BATCH_SIZE: number;
  DELAY_BETWEEN_BATCHES: number;
  DB_BATCH_SIZE: number;
  MAX_RETRIES: number;
  [key: string]: any;

  // Email notification settings
  EMAIL_NOTIFICATIONS_ENABLED: boolean;
  EMAIL_NOTIFICATION_INTERVAL: number; // ms
  EMAIL_HOST: string;
  EMAIL_PORT: number;
  EMAIL_SECURE: boolean;
  EMAIL_USER: string;
  EMAIL_PASSWORD: string;
  EMAIL_FROM: string;
  EMAIL_TO: string;

  // Custom WHERE clauses for different job types
  WHERE_CLAUSES: {
    [jobType: string]: string;
  };
}

class ConfigurationService {
  private static instance: ConfigurationService;
  private config: SystemConfig = {
    CONCURRENT_BATCHES: 10,
    BATCH_SIZE: 100,
    DELAY_BETWEEN_BATCHES: 800,
    DB_BATCH_SIZE: 1000,
    MAX_RETRIES: 3,

    // Default email notification settings
    EMAIL_NOTIFICATIONS_ENABLED: true, // Default to true
    EMAIL_NOTIFICATION_INTERVAL: 7200000, // 2 hours
    EMAIL_HOST: "smtp.company.com",
    EMAIL_PORT: 587,
    EMAIL_SECURE: false,
    EMAIL_USER: "",
    EMAIL_PASSWORD: "",
    EMAIL_FROM: "Priority Job System <noreply@carmelton-migration.com>",
    EMAIL_TO: "<yotamt@one1.co.il>",

    // Custom WHERE clauses for different job types
    WHERE_CLAUSES: {},
  };
  private lastLoaded: Date = new Date(0);
  private cacheExpiryMs: number = 60000; // 1 minute cache
  private pollingInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;

  private constructor() {
    // Initialize config on startup, but with error handling
    this.initializeConfig();
  }

  private async initializeConfig(): Promise<void> {
    try {
      // Wait a moment to ensure DatabaseService is fully initialized
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await this.loadConfigFromDb();
      console.log("Initial configuration loaded");
      this.lastLoaded = new Date();
      this.isInitialized = true;

      // Set up polling for config changes
      // this.startPolling();
    } catch (error) {
      console.error("Failed to initialize configuration, will retry:", error);
      // Retry after a delay
      setTimeout(() => this.initializeConfig(), 5000);
    }
  }

  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  public async getConfig(): Promise<SystemConfig> {
    // If not initialized yet, wait for initialization or use default values
    if (!this.isInitialized) {
      console.log("Configuration not yet initialized, using defaults");
      return this.config;
    }

    const now = new Date();
    // Still keep the cache expiry check as a fallback
    if (now.getTime() - this.lastLoaded.getTime() > this.cacheExpiryMs) {
      await this.loadConfigFromDb();
      this.lastLoaded = now;
    }
    return this.config;
  }

  private async loadConfigFromDb(): Promise<void> {
    try {
      // Verify DatabaseService exists and has executeQuery method
      if (
        !DatabaseService ||
        typeof DatabaseService.executeQuery !== "function"
      ) {
        throw new Error("DatabaseService is not properly initialized");
      }

      const result = (await DatabaseService.executeQuery(`
        SELECT ConfigKey, ConfigValue FROM PrioritySystemConfig
      `)) as { ConfigKey: string; ConfigValue: string }[];

      if (result && result.length > 0) {
        const newConfig: SystemConfig = { ...this.config };

        // Initialize WHERE_CLAUSES if it doesn't exist
        if (!newConfig.WHERE_CLAUSES) {
          newConfig.WHERE_CLAUSES = {};
        }

        result.forEach((row) => {
          // Check if this is a WHERE clause configuration
          if (row.ConfigKey.startsWith("WHERE_CLAUSE_")) {
            const jobType = row.ConfigKey.substring("WHERE_CLAUSE_".length);
            newConfig.WHERE_CLAUSES[jobType] = row.ConfigValue;
            // console.log(
            //   `Loaded WHERE clause for job type ${jobType}: ${row.ConfigValue}`
            // );
          } else {
            let value: any = row.ConfigValue;

            if (!isNaN(Number(value))) {
              value = Number(value);
            } else if (
              value.toLowerCase() === "true" ||
              value.toLowerCase() === "false"
            ) {
              value = value.toLowerCase() === "true";
            }

            newConfig[row.ConfigKey] = value;
          }
        });

        // Log the loaded WHERE clauses for debugging
        // console.log(
        //   "Loaded WHERE_CLAUSES:",
        //   JSON.stringify(newConfig.WHERE_CLAUSES, null, 2)
        // );

        this.config = newConfig;
      }
    } catch (error) {
      console.error("Error loading configuration from database:", error);
      throw error; // Re-throw so the caller knows something went wrong
    }
  }

  public async updateConfig(key: string, value: any): Promise<boolean> {
    try {
      await DatabaseService.executeQuery(
        `
      UPDATE PrioritySystemConfig 
      SET ConfigValue = @ConfigValue, LastUpdated = @LastUpdated
      WHERE ConfigKey = @ConfigKey
    `,
        {
          ConfigKey: key,
          ConfigValue: String(value),
          LastUpdated: new Date(),
        }
      );

      // Update the in-memory config as well
      await this.loadConfigFromDb();

      return true;
    } catch (error) {
      console.error(`Failed to update config ${key}:`, error);
      return false;
    }
  }

  // Add cleanup method for proper application shutdown
  public shutdown(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log("Configuration polling stopped");
    }
  }
  //------------------------------------------
  // 03/06/2025

  /**
   * Gets the custom WHERE clause for a specific job type with proper SQL formatting
   * @param jobType The job type identifier
   * @returns The properly formatted custom WHERE clause or null if not defined
   */
  public async getWhereClauseForJobType(
    jobType: string
  ): Promise<string | null> {
    const config = await this.getConfig();
    // console.log(`Retrieving WHERE clause for job type: ${jobType}`);
    // console.log(
    //   `Available WHERE clauses:`,
    //   JSON.stringify(config.WHERE_CLAUSES || {}, null, 2)
    // );

    const whereClause = config.WHERE_CLAUSES?.[jobType] || null;

    // Format the WHERE clause if it exists
    const formattedWhereClause = whereClause
      ? this.formatWhereClause(whereClause)
      : null;

    // console.log(`Retrieved WHERE clause: ${whereClause}`);
    // if (formattedWhereClause !== whereClause) {
    //   console.log(`Formatted WHERE clause: ${formattedWhereClause}`);
    // }

    return formattedWhereClause;
  }
  //------------------------------------------
  /**
   * Gets the default base WHERE clause used in all queries
   * @returns The base WHERE clause that should always be included
   */
  public getBaseWhereClause(): string {
    return "is_eligible = 1 AND is_new = 1 AND (Status IS NULL OR Status = 'Failed')";
  }
  //------------------------------------------
  /**
   * Sets a custom WHERE clause for a specific job type
   * @param jobType The job type identifier
   * @param whereClause The WHERE clause to set (without the "WHERE" keyword)
   * @returns Success status
   */
  public async setWhereClauseForJobType(
    jobType: string,
    whereClause: string
  ): Promise<boolean> {
    try {
      // Validate the WHERE clause
      if (!this.isValidWhereClause(whereClause)) {
        console.error(`Invalid WHERE clause format: ${whereClause}`);
        return false;
      }

      // Store in config DB with proper key format
      const configKey = `WHERE_CLAUSE_${jobType}`;
      await this.updateConfig(configKey, whereClause);

      // Update in-memory config
      if (!this.config.WHERE_CLAUSES) {
        this.config.WHERE_CLAUSES = {};
      }
      this.config.WHERE_CLAUSES[jobType] = whereClause;

      return true;
    } catch (error) {
      console.error(
        `Failed to set WHERE clause for job type ${jobType}:`,
        error
      );
      return false;
    }
  }
  //------------------------------------------
  /**
   * Validates a WHERE clause for basic syntax and security issues
   * @param whereClause The WHERE clause to validate
   * @returns True if the clause appears valid
   */
  private isValidWhereClause(whereClause: string): boolean {
    if (!whereClause || typeof whereClause !== "string") return false;

    // Remove any WHERE keyword that might have been added
    const normalizedClause = whereClause.trim().replace(/^WHERE\s+/i, "");

    // Basic validation - check for dangerous patterns
    const dangerousPatterns = [
      /;/, // No semicolons (SQL injection)
      /--/, // No SQL comments
      /\/\*/, // No block comments
      /DROP\s+TABLE/i, // No DROP TABLE
      /ALTER\s+TABLE/i, // No ALTER TABLE
      /DELETE\s+FROM/i, // No DELETE FROM
      /INSERT\s+INTO/i, // No INSERT INTO
      /UPDATE\s+.*\s+SET/i, // No UPDATE
      /EXEC\s*\(/i, // No EXEC
      /EXECUTE\s*\(/i, // No EXECUTE
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(normalizedClause)) {
        return false;
      }
    }

    // Balanced parentheses check
    let openParens = 0;
    for (let i = 0; i < normalizedClause.length; i++) {
      if (normalizedClause[i] === "(") openParens++;
      if (normalizedClause[i] === ")") openParens--;
      if (openParens < 0) return false;
    }
    if (openParens !== 0) return false;

    return true;
  }
  //------------------------------------------
  /**
   * Combines the base WHERE clause with a custom WHERE clause
   * @param customWhereClause The custom WHERE clause to add (optional)
   * @returns A complete WHERE clause to use in queries
   */
  public combineWhereClauses(customWhereClause?: string): string {
    const baseClause = this.getBaseWhereClause();

    if (!customWhereClause) {
      return baseClause;
    }

    // Format the custom WHERE clause before combining
    const formattedCustomWhereClause =
      this.formatWhereClause(customWhereClause);
    return `${baseClause} AND (${formattedCustomWhereClause})`;
  }
  //------------------------------------------
  /**
   * Properly formats a WHERE clause for SQL by escaping identifiers
   * @param whereClause The original WHERE clause
   * @returns Formatted WHERE clause with escaped column names
   */
  public formatWhereClause(whereClause: string): string {
    if (!whereClause) return whereClause;

    // List of common SQL keywords that might be used as column names
    const sqlKeywords = [
      "ERROR",
      "SELECT",
      "FROM",
      "WHERE",
      "ORDER",
      "GROUP",
      "BY",
      "HAVING",
      "JOIN",
      "INNER",
      "OUTER",
      "LEFT",
      "RIGHT",
      "ON",
      "UNION",
      "ALL",
      "INTO",
      "UPDATE",
      "DELETE",
      "INSERT",
      "VALUES",
      "SET",
      "CREATE",
      "TABLE",
      "VIEW",
      "PROCEDURE",
      "FUNCTION",
      "TRIGGER",
      "CHECK",
      "DEFAULT",
      "CONSTRAINT",
      "PRIMARY",
      "FOREIGN",
      "KEY",
      "INDEX",
      "UNIQUE",
      "NOT",
      "NULL",
      "IS",
      "IN",
      "LIKE",
      "BETWEEN",
      "AND",
      "OR",
      "AS",
      "CASE",
      "WHEN",
      "THEN",
      "ELSE",
      "END",
    ];

    // Create a regex pattern to match SQL keywords used as column identifiers
    const keywordPattern = new RegExp(
      `\\b(${sqlKeywords.join("|")})\\b\\s*=`,
      "gi"
    );

    // Replace with escaped version [Keyword] =
    return whereClause.replace(keywordPattern, "[$1] =");
  }
  //------------------------------------------
  /**
   * Removes a custom WHERE clause for a specific job type by setting its value to empty
   * @param jobType The job type identifier
   * @returns Success status
   */
  public async removeWhereClauseForJobType(jobType: string): Promise<boolean> {
    try {
      // Format the configuration key
      const configKey = `WHERE_CLAUSE_${jobType}`;

      // Set to empty string rather than deleting the row
      await DatabaseService.executeQuery(
        `UPDATE PrioritySystemConfig 
       SET ConfigValue = '', LastUpdated = GETDATE() 
       WHERE ConfigKey = @configKey`,
        { configKey }
      );

      // Update in-memory config to empty string (not null)
      if (this.config.WHERE_CLAUSES) {
        this.config.WHERE_CLAUSES[jobType] = "";
      }

      console.log(`Successfully cleared WHERE clause for job type ${jobType}`);
      return true;
    } catch (error) {
      console.error(
        `Failed to clear WHERE clause for job type ${jobType}:`,
        error
      );
      return false;
    }
  }
}

export const configService = ConfigurationService.getInstance();
