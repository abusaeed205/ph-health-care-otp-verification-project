import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { CreatePrescriptionValidationZodSchema } from "./prescription.validation";
import { validateRequest } from "../../middleware/zodValidateRequest";
import { PrescriptionController } from "./prescription.conroller";

const router = Router();

router.post(
    "/create-prescription",
    auth(Role.DOCTOR),
    validateRequest(CreatePrescriptionValidationZodSchema),
    PrescriptionController.createPrescription,
);

router.get(
    "/:appointmentId",
    auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
    PrescriptionController.getSinglePrescription,
);

export const PrescriptionRoutes = router;
