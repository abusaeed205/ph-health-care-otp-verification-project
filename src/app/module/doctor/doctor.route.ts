import { Router } from "express";
import { DoctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";

const route = Router();

route.post(
	"/apply-as-doctor",
	upload.fields([
		{
			name: "resume",
			maxCount: 1,
		},
		{
			name: "additionalFiles",
			maxCount: 2,
		},
	]),
	DoctorController.applyAsDoctor,
);

export const DoctorRoutes = route;
