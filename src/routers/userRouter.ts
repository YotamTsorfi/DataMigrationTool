// userRouter.ts

import { Router } from "express";
import { getUsers } from "../controllers/userController";

const userRouter = Router();

// http://localhost:3001/api/users
userRouter.get("/users", getUsers);

export default userRouter;
