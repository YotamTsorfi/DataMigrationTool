import { poolPromise } from "./db";

interface SystemConfig {
  CONCURRENT_BATCHES: number;
  BATCH_SIZE: number;
  DELAY_BETWEEN_BATCHES: number;
  [key: string]: any;
}

class ConfigurationService {
  private static instance: ConfigurationService;
  private config: SystemConfig = {
    CONCURRENT_BATCHES: 10, // Default value
    BATCH_SIZE: 100, // Default value
    DELAY_BETWEEN_BATCHES: 6000, // Default value
  };
  private lastLoaded: Date = new Date(0);
  private cacheExpiryMs: number = 60000; // Refresh config every minute

  private constructor() {}

  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  public async getConfig(): Promise<SystemConfig> {
    const now = new Date();
    // If cache expired, reload from database
    if (now.getTime() - this.lastLoaded.getTime() > this.cacheExpiryMs) {
      await this.loadConfigFromDb();
      this.lastLoaded = now;
    }
    return this.config;
  }

  private async loadConfigFromDb(): Promise<void> {
    try {
      const pool = await poolPromise;
      if (!pool) {
        console.error("Failed to connect to database for config loading");
        return;
      }

      const result = await pool.request().query(`
        SELECT ConfigKey, ConfigValue FROM PrioritySystemConfig
      `);

      if (result.recordset.length > 0) {
        const newConfig: SystemConfig = { ...this.config }; // Start with defaults
        
        result.recordset.forEach((row: { ConfigKey: string; ConfigValue: string }) => {
          // Convert string values to appropriate types
          let value: any = row.ConfigValue;
          
          // Try to convert to number if possible
          if (!isNaN(Number(value))) {
            value = Number(value);
          } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
            value = value.toLowerCase() === 'true';
          }
          
          newConfig[row.ConfigKey] = value;
        });
        
        this.config = newConfig;
      }
    } catch (error) {
      console.error("Error loading configuration from database:", error);
    }
  }

  public async updateConfig(key: string, value: any): Promise<boolean> {
    try {
      const pool = await poolPromise;
      if (!pool) return false;

      await pool.request()
        .input('ConfigKey', key)
        .input('ConfigValue', String(value))
        .input('LastUpdated', new Date())
        .query(`
          UPDATE PrioritySystemConfig 
          SET ConfigValue = @ConfigValue, LastUpdated = @LastUpdated
          WHERE ConfigKey = @ConfigKey
        `);

      // Update in-memory cache
      this.config[key] = typeof value === 'string' && !isNaN(Number(value)) ? Number(value) : value;
      return true;
    } catch (error) {
      console.error(`Failed to update config ${key}:`, error);
      return false;
    }
  }
}

export const configService = ConfigurationService.getInstance();