import httpStatus from "http-status";
import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserServices } from "./user.service";


const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
	console.log(req.file?.buffer, "req.file");

	if (!req.file) {
		throw new Error("No file uploaded");
	}

	const userId = req.user?.userId;

	const result = await UserServices.uploadProfileImage(
		req.file?.buffer,
		userId!,
	);
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "image upload success",
		data: result,
	});
});

export const userController = {
	uploadProfileImage,
};
