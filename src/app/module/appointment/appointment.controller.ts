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
	const user = req.user!; //পরে +
	// service পাঠাচ্ছি
	const result = await AppointmentServices.cancelAppointment(payload, user);

	console.log("controler", result);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointment Payment Initiated successfully",
		data: result,
	});
});

const updateAppointmentStatus = catchAsync(
	async (req: Request, res: Response) => {
		const appointmentId = req.params.appointmentId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await AppointmentServices.updateAppointmentStatus(
			appointmentId,
			payload,
			user,
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Appointment Status Updated Successfully",
			data: result,
		});
	},
);

const getMyAppointments = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await AppointmentServices.getMyAppoinents(
		req.query,
		user,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointments Retrieved Successfully",
		data,
		meta,
	});
});

const getDoctorAppointments = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } = await AppointmentServices.getDoctorAppoinents(
			req.query,
			user,
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Appointments Retrieved Successfully",
			data,
			meta,
		});
	},
);

const getAllAppointments = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AppointmentServices.getAllAppoinents(
		req.query,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointments Retrieved Successfully",
		data,
		meta,
	});
});

const getSingleAppointment = catchAsync(async (req: Request, res: Response) => {
	const appointmentId = req.params.appointmentId as string;
	const user = req.user!;

	const result = await AppointmentServices.getSigleAppoinents(
		appointmentId,
		user,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Appointment Retrieved Successfully",
		data: result,
	});
});


export const AppointMentController = {
	bookAppointment,
	payAppointment,
	bookAppointmentcallback,
	cancellAppointment,
	updateAppointmentStatus,
	getMyAppointments,
    getDoctorAppointments,
	getAllAppointments,
	getSingleAppointment 

};
