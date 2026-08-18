import { Router } from "express";
import { AppointMentController } from "./appointment.controller";

const router = Router();

router.post("/book-appointment", AppointMentController.bookAppointment);

// book appointment callback url
router.get("/book-appointment/book-appointment/payment/callback", () => {});

export const appointmentRoutes = router;
