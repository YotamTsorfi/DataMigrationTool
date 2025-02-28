import { Request, Response, NextFunction } from 'express';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';

// הרחבת אובייקט Request
declare global {
  namespace Express {
    interface Request {
      priorityAxios?: AxiosInstance;
      priorityBatchAxios?: AxiosInstance;
    }
  }
}

export function priorityAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const priorityAxios = axios.create({
      baseURL: config.priorityBaseUrl,
      auth: {
        username: config.priorityPAT,
        password: config.priorityPassword
      },
      headers: {
        'Content-Type': 'application/json',
        'OData-Version': '4.0',
        'Accept': 'application/json'
      },
      timeout: 30000, // 30 שניות
      validateStatus: function (status) {
        return status >= 200 && status < 300; // ברירת מחדל
      }
    });

    const priorityBatchAxios = axios.create({
      baseURL: config.priorityBaseUrl.replace(/\/$/, ''), // מסיר סלאש בסוף אם קיים
      auth: {
          username: config.priorityPAT,
          password: config.priorityPassword
      },
      headers: {
          'Content-Type': 'multipart/mixed',
          'OData-Version': '4.0'
      },
      timeout: 30000
  });

  // הוספת interceptors לדיבוג
priorityBatchAxios.interceptors.request.use(
  config => {
      console.log('Request Config:', {
          method: config.method,
          url: config.url,
          headers: config.headers,
          data: config.data
      });
      return config;
  },
  error => {
      console.error('Request Error:', error);
      return Promise.reject(error);
  }
);

    // הוספת interceptors לטיפול בתגובות ושגיאות
    [priorityAxios, priorityBatchAxios].forEach(instance => {
      instance.interceptors.response.use(
        response => {
          console.log('Priority Axios Response:', {
            status: response.status,
            data: response.data
          });
          return response;
        },
        error => {
          console.error('Priority Axios Error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
          });
          return Promise.reject(error);
        }
      );
    });

    req.priorityAxios = priorityAxios;
    req.priorityBatchAxios = priorityBatchAxios;
    next();
  } catch (error) {
    console.error('Authentication Middleware Error:', error);
    res.status(500).json({
      message: 'Failed to create Priority authentication',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
