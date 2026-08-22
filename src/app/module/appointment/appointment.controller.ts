import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppointmentServices } from "./appointment.service";

const bookAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body; //পরে +
	const user = req.user!; //পরে +
	// service পাঠাচ্ছি
	const result = await AppointmentServices.bookAppointment(payload, user);

	console.log("controler", result);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched Successfully",
		data: result,
	});
});

const payAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body; //পরে +
	const user = req.user!; //পরে +
	// service পাঠাচ্ছি
	const result = await AppointmentServices.payAppointment(payload, user);

	console.log("controler", result);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointment Payment Initiated successfully",
		data: result,
	});
});

const bookAppointmentcallback = catchAsync(
	async (req: Request, res: Response) => {
		const { redirecUrl } = await AppointmentServices.bookAppointmentCallback(
			req.query,
		);
		res.redirect(redirecUrl);
	},
);

const cancellAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body; //পরে +
	// service পাঠাচ্ছি
	const result = await AppointmentServices.cancelAppointment(payload);

	console.log("controler", result);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointment Payment Initiated successfully",
		data: result,
	});
});

export const AppointMentController = {
	bookAppointment,
	payAppointment,
	bookAppointmentcallback,
	cancellAppointment,
};
