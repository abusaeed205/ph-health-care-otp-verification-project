
import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/zodValidateRequest";
import { AuthController } from "./auth.controller";
import { ZodUserValidation } from "./auth.validation";


const router = Router();


router.post("/register",validateRequest(ZodUserValidation.patentZodSchema), AuthController.registerPatient);
router.post("/login", AuthController.loginUser);
router.get(
	"/me",
	auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
	AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/google",AuthController.googleLoginController)
router.post("/forgetpassword",validateRequest(ZodUserValidation.forgetPasswordZodSchema),AuthController.forgetPassword)
router.post("/resetpassword",validateRequest(ZodUserValidation.resetPasswordZodSchema),AuthController.resetPassword)
export const AuthRoutes = router;
