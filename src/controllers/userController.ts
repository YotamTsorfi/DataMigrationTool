//userController.ts

import { Request, Response } from 'express';
import { poolPromise } from "../config/db";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const pool = await poolPromise;
    if (pool) {
      const result = await pool.request().query("SELECT * FROM Users");
      res.json(result.recordset);
    } else {
      res.status(500).send("Database connection failed.");
    }
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).send(err.message);
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};