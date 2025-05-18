import { Request, Response, NextFunction } from "express";
import axios, { AxiosInstance } from "axios";
import { config } from "../config/config";
// import { url } from "inspector";

// set up global namespace for Express Request
declare global {
  namespace Express {
    interface Request {
      priorityAxios?: AxiosInstance;
      priorityBatchAxios?: AxiosInstance;
    }
  }
}

export function priorityAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const priorityAxios = axios.create({
      baseURL: config.priorityDEVBaseUrl,
      auth: {
        username: config.priorityPAT,
        password: config.priorityPassword,
      },
      headers: {
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        Accept: "application/json",
      },
      timeout: 120000, // 60 seconds
      proxy: false,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300; // default
      },
    });

    const priorityBatchAxios = axios.create({
      baseURL: config.priorityDEVBaseUrl.replace(/\/$/, ""), // remove trailing slash
      auth: {
        username: config.priorityPAT,
        password: config.priorityPassword,
      },
      headers: {
        "Content-Type": "multipart/mixed",
        "OData-Version": "4.0",
      },
      timeout: 120000,
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
            // data: response.data
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
