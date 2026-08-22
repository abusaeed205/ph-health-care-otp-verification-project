import { Router } from "express";
import { AppointMentController } from "./appointment.controller";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";

const router = Router();

router.post(
	"/book-appointment",
	auth(Role.PATIENT),
	AppointMentController.bookAppointment,
);

router.post(
	"/pay-appointment",
	auth(Role.PATIENT),
	AppointMentController.payAppointment,
);

router.post(
	"/cancel-appointment",
	auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
	AppointMentController.cancellAppointment,
);

// book appointment callback url(bkush call দিবে )
router.get(
	"/book-appointment/payment/callback",
	AppointMentController.bookAppointmentcallback,
);

export const appointmentRoutes = router;
