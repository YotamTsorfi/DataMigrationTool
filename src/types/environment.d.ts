// src/types/environment.d.ts

declare namespace NodeJS {
    interface ProcessEnv {
      PRIORITY_BASE_URL: string;
      PRIORITY_PAT: string;
      PRIORITY_PASSWORD: string;

      PORT?: string;
      CARMELTON_DB_USER:string;
      CARMELTON_DB_PASSWORD:string;
      CARMELTON_DB_SERVER:string;
      CARMELTON_DB_NAME:string;
      CARMELTON_DB_PORT:string;

    
    }
  }