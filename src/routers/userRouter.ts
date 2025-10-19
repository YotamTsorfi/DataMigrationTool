// userRouter.ts

import { Router } from "express";
import { getUsers } from "../controllers/userController";

const userRouter = Router();

userRouter.get("/users", getUsers);

export default userRouter;
