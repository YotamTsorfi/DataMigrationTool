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

        result.forEach((row) => {
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
        });

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
}

export const configService = ConfigurationService.getInstance();
