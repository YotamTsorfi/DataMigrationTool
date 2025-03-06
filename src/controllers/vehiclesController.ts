//vehiclesController.ts

import { Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { config } from "../config/config";
//--------------------------------------------------

export const vehiclesController = {  
  //----------------------------------------------------
  async getAllVehicles(req: Request, res: Response) {
    try {
      const response = await req.priorityAxios?.get(
        `${config.priorityDEVBaseUrl}/NATF_VEHICLES`
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
      const response = await req.priorityAxios?.get(
        `${config.priorityDEVBaseUrl}/NATF_VEHICLES('${id}')`
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
        `${config.priorityDEVBaseUrl}/NATF_VEHICLES`,
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
        `${config.priorityDEVBaseUrl}/NATF_VEHICLES(${id})`,
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
        `${config.priorityDEVBaseUrl}/NATF_VEHICLES(${id})`
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