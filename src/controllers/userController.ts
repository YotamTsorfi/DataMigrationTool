//userController.ts

import { Request, Response } from "express";
import { DatabaseService } from "../services/databaseService";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await DatabaseService.executeQuery("SELECT * FROM Users");
    res.json(users);
  } catch (err) {
    if (err instanceof Error) {
      res.status(500).send(err.message);
    } else {
      res.status(500).send("An unknown error occurred.");
    }
  }
};
