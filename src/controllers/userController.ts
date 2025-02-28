//userController.ts

import { Request, Response } from 'express';
import sql from '../database/connection';

export const getUsers = async (req: Request, res: Response) => {
    try {
        const result = await sql.query`SELECT * FROM Users`;
        res.json(result.recordset);
    } catch (err) {
        if (err instanceof Error) {
            res.status(500).send(err.message);
        } else {
            res.status(500).send('An unknown error occurred.');
        }
    }
};