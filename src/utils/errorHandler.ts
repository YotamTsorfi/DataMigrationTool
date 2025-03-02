import axios, { AxiosError } from "axios";
import { Response } from "express";

export function handleError(error: unknown, res: Response) {
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