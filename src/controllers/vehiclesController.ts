//vehiclesController.ts

import { Request, Response, NextFunction } from "express";
import { RequestHandler } from 'express';
import axios, { AxiosError } from "axios";
import { config } from "../config/config";
import PerformanceMonitor from '../utils/performanceMonitor';

//--------------------------------------------------
export const vehiclesController = {

  batchCreateVehicles: (async (req: Request, res: Response, next: NextFunction) => {
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startOperation();

    console.log('Starting batchCreateVehicles function');
    try {
        const { vehicles } = req.body;

        if (!Array.isArray(vehicles) || vehicles.length === 0) {
            return res.status(400).json({
                error: 'Invalid vehicles data',
                details: 'Vehicles must be a non-empty array'
            });
        }
        
        // מדידת גודל הבקשה
        perfMonitor.logRequestMetrics({ vehicles });
        console.log(`Processing ${vehicles.length} vehicles`);

        const boundary = `batch_${Date.now()}`;
        let batchBody = '';

        vehicles.forEach((vehicle: any, index: number) => {
            batchBody += `--${boundary}\r\n`;
            batchBody += `Content-Type: application/http\r\n`;
            batchBody += `Content-Transfer-Encoding: binary\r\n\r\n`;
            batchBody += `POST NATF_VEHICLES HTTP/1.1\r\n`;
            batchBody += `Content-Type: application/json\r\n\r\n`;
            batchBody += `${JSON.stringify(vehicle)}\r\n\r\n`;
        });

        batchBody += `--${boundary}--`;

        if (!req.priorityBatchAxios) {
            throw new Error('Priority Batch Axios instance not found');
        }

        const response = await req.priorityBatchAxios.post('$batch', batchBody, {
            headers: {
                'Content-Type': `multipart/mixed;boundary=${boundary}`
            }
        });

        perfMonitor.logResponseMetrics(response.data, response.status);

        const result = {
          message: "Batch vehicles created successfully",
          vehiclesCount: vehicles.length,
          data: response.data,
          requestSize: perfMonitor.metrics.requestSize,
          responseSize: perfMonitor.metrics.responseSize,
          duration: perfMonitor.metrics.duration,
          averageTimePerRecord: perfMonitor.metrics.averageTimePerRecord,
        };

        perfMonitor.endOperation();
        return res.status(201).json(result);

    } catch (error) {
        perfMonitor.logError(error);
        console.error('Error in batchCreateVehicles:', error);
        return handleError(error, res);
    }
}) as RequestHandler,


//----------------------------------------------------
  async getAllVehicles(req: Request, res: Response) {
    try {
      const response = await req.priorityAxios?.get(
        `${config.priorityBaseUrl}/NATF_VEHICLES`
      );

      res.status(200).json({
        message: "Vehicles retrieved successfully",
        data: response?.data,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
  //----------------------------------------------------
  async getVehicleById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      // TODO - Needs to change to NATF_VEHICLES('42972502')
      const response = await req.priorityAxios?.get(
        `${config.priorityBaseUrl}/NATF_VEHICLES(${id})`
      );

      res.status(200).json({
        message: "Vehicle retrieved successfully",
        data: response?.data,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
  //----------------------------------------------------
  async createVehicle(req: Request, res: Response) {
    try {
      const newVehicle = req.body;
      const response = await req.priorityAxios?.post(
        `${config.priorityBaseUrl}/NATF_VEHICLES`,
        newVehicle
      );

      res.status(201).json({
        message: "Vehicle created successfully",
        data: response?.data,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
  //----------------------------------------------------
  async updateVehicle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updatedVehicle = req.body;
      const response = await req.priorityAxios?.put(
        `${config.priorityBaseUrl}/NATF_VEHICLES(${id})`,
        updatedVehicle
      );

      res.status(200).json({
        message: "Vehicle updated successfully",
        data: response?.data,
      });
    } catch (error) {
      handleError(error, res);
    }
  },
  //----------------------------------------------------
  async deleteVehicle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await req.priorityAxios?.delete(
        `${config.priorityBaseUrl}/NATF_VEHICLES(${id})`
      );

      res.status(200).json({
        message: "Vehicle deleted successfully",
      });
    } catch (error) {
      handleError(error, res);
    }
  },
};
//----------------------------------------------------
// פונקציית עזר לטיפול בשגיאות
function handleError(error: unknown, res: Response) {
  console.error("Full error details:", error);

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    console.error("Axios Error Details:", {
      response: axiosError.response?.data,
      status: axiosError.response?.status,
      headers: axiosError.response?.headers,
      message: axiosError.message,
    });

    res.status(axiosError.response?.status || 500).json({
      message: "Operation failed",
      error: {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      },
    });
  } else {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      message: "Unexpected error",
      error: errorMessage,
    });
  }
}
