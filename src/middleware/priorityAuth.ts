import { Request, Response, NextFunction } from "express";
import axios, { AxiosInstance } from "axios";
import { configService } from "../config/configService"; // DB

// set up global namespace for Express Request
// Module augmentation instead of namespace
declare module "express" {
  interface Request {
    priorityAxios?: AxiosInstance;
    priorityBatchAxios?: AxiosInstance;
  }
}

export async function priorityAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Get configuration from database instead of environment variables
    const config = await configService.getConfig();

    // Validate that required config values exist
    if (!config) {
      throw new Error("Configuration not found");
    }

    if (!config.PRIORITY_BASE_URL) {
      throw new Error("PRIORITY_BASE_URL is missing in configuration");
    }

    if (!config.PRIORITY_COMPANY) {
      throw new Error("PRIORITY_COMPANY is missing in configuration");
    }

    // Check if the base URL ends with a slash and the screen name starts with one
    let baseUrl = config.PRIORITY_BASE_URL;
    if (!baseUrl.endsWith("/")) baseUrl += "/";
    let company = config.PRIORITY_COMPANY;
    if (company.endsWith("/")) company = company.slice(0, -1);

    // Construct the full URL for the request
    const url = `${baseUrl}${company}`;

    const priorityAxios = axios.create({
      baseURL: url,
      auth: {
        username: config.PRIORITY_PAT,
        password: config.PRIORITY_PASSWORD,
      },
      headers: {
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        Accept: "application/json",
      },
      timeout: config.TIME_OUT,
      proxy: false,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300; // default
      },
    });

    const priorityBatchAxios = axios.create({
      baseURL: url,
      auth: {
        username: config.PRIORITY_PAT,
        password: config.PRIORITY_PASSWORD,
      },
      headers: {
        "Content-Type": "multipart/mixed",
        "OData-Version": "4.0",
      },
      timeout: config.TIME_OUT,
    });

    // add interceptors for request logging
    priorityBatchAxios.interceptors.request.use(
      (config) => {
        console.log("Request Config:", {
          method: config.method,
          url: config.url,
          // headers: config.headers,
          // data: config.data
        });
        return config;
      },
      (error) => {
        console.error("Request Error:", error.message);
        return Promise.reject(error);
      }
    );

    // add interceptors for response logging
    [priorityAxios, priorityBatchAxios].forEach((instance) => {
      instance.interceptors.response.use(
        (response) => {
          console.log("Priority Axios Response:", {
            status: response.status,
            url: response.config.url,
          });
          return response;
        },
        (error) => {
          // Create a simplified error object
          const simplifiedError = {
            message: error.message,
            code: error.code,
            status: error.response?.status || "No Response",
            url: error.config?.url || "Unknown URL",
          };

          // For connection errors like ETIMEDOUT, provide a more user-friendly message
          if (error.code === "ETIMEDOUT") {
            console.error(
              `Priority API connection timed out: Could not connect to ${simplifiedError.url}`
            );
          } else if (error.code === "ECONNREFUSED") {
            console.error(
              `Priority API connection refused: ${simplifiedError.url} is unreachable`
            );
          } else {
            console.error("Priority API Error:", simplifiedError);
          }

          return Promise.reject(error);
        }
      );
    });

    req.priorityAxios = priorityAxios;
    req.priorityBatchAxios = priorityBatchAxios;
    next();
  } catch (error) {
    console.error("Authentication Middleware Error:", error);
    res.status(500).json({
      message: "Failed to create Priority authentication",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
