import { Router } from "express";
import { userController } from "./user.controller";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const route = Router();
// upload lib ফোল্ডার থেকে আসতেছে
route.patch(
	"/profile-image",
	auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
	upload.single("profileimage"),
	userController.uploadProfileImage,
);

export const UserRoutes = route;
