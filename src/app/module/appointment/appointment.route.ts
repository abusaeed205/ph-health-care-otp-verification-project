import { Router } from "express";
import { AppointMentController } from "./appointment.controller";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { BookAppointmentValidationZodSchema, UpdateAppointmentStatusValidationZodSchema } from "./appointments.validation";
import { validateRequest } from "../../middleware/zodValidateRequest";

const router = Router();

router.post(
	"/book-appointment",
	auth(Role.PATIENT),
	validateRequest(BookAppointmentValidationZodSchema),
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

router.patch(
	"/update-status/:appointmentId",
	auth(Role.DOCTOR),
	validateRequest(UpdateAppointmentStatusValidationZodSchema),
	AppointMentController.updateAppointmentStatus,
);

router.get(
	"/my-appointments",
	auth(Role.PATIENT),
	AppointMentController.getMyAppointments,
);

router.get(
	"/doctor-appointments",
	auth(Role.DOCTOR),
	AppointMentController.getDoctorAppointments,
);

router.get(
	"/all-appointments",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AppointMentController.getAllAppointments,
);

router.get(
	"/:appointmentId",
	auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
	AppointMentController.getSingleAppointment,
);





export const appointmentRoutes = router;
