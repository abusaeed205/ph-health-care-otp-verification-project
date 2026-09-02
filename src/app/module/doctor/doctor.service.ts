import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import {
	DoctorVerificationStatus,
	Role,
	Schedulestatus,
} from "../../../generated/prisma/enums";
import crypto from "crypto";
import { redisclient } from "../../lib/redis";
import path from "path";
import { transporter } from "../../lib/nodemailler";
import ejs from "ejs";
import {
	IApplyAsDoctorPayload,
	IApproveDoctorPayload,
	IUpdateDoctorProfilePayload,
	IVerifyDoctorEmailPayload,
} from "./doctor.interface";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { IPostQuery } from "../../interface";
import { DoctorWhereInput } from "../../../generated/prisma/models";
import { AppError } from "../../utils/appError";
import { addDays, startOfDay } from "date-fns";

const applyAsDoctor = async (
	payload: IApplyAsDoctorPayload,
	resume: Express.Multer.File | null,
	additionalFiles: Express.Multer.File[],
) => {
	const isUserExist = await prisma.user.findUnique({
		where: {
			email: payload.user.email,
		},
	});

	if (isUserExist) {
		throw new Error("User Allready Exists With This Email");
	}

	//শৃুধু মত্র resume → একবার upload
	const resumeUploadResult = await new Promise<UploadApiResponse>(
		// <UploadApiResponse> এটা Cloudinary package থেকে আসছে।
		(resolve, reject) => {
			//from lib folder
			cloudinary.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},
					async (error, result) => {
						if (error) {
							return reject(error);
						}

						if (!result) {
							return reject(new Error("No result returned from cloudinary"));
						}

						resolve(result);
					},
				)
				.end(resume?.buffer); // resume paylode এর ওখান থেকে আসছে
		},
	);

	// একাধিক file upload
	const additionalFilesUploadResult = await Promise.all(
		additionalFiles.map((file) => {
			// প্রতিটি additional file Cloudinary-তে upload করার জন্য Promise তৈরি করছি
			return new Promise<UploadApiResponse>((resolve, reject) => {
				cloudinary.uploader
					.upload_stream(
						{
							// PDF, JPG, PNG ইত্যাদি automatically handle করবে
							resource_type: "auto",
						},
						(error, result) => {
							// Cloudinary upload error হলে Promise reject হবে
							if (error) {
								return reject(error);
							}

							// কোনো result না পেলে error throw হবে
							if (!result) {
								return reject(new Error("No result returned from Cloudinary"));
							}

							// Upload সফল হলে Cloudinary result return করবে
							resolve(result);
						},
					)
					// Multer থেকে পাওয়া file buffer Cloudinary-তে পাঠাচ্ছি
					.end(file.buffer);
			});
		}),
	);

	// Generate random password
	const randomDoctorPassword = Math.random().toString(36).slice(-8);
	const hashedPassword = await bcrypt.hash(
		randomDoctorPassword,
		Number(config.bcrypt_salt_rounds),
	);

	// Create User + Doctor
	// এখানে এক সাথে  user & doctor এর ডাটা Create হচ্ছে
	//   এটা মাল্টি ভেন্ডর ওয়েব সাইটে এ কাজে দিবে
	const doctorApplication = await prisma.user.create({
		data: {
			...payload.user, //user data
			password: hashedPassword,
			role: Role.DOCTOR,
			needPasswordChange: true,
			doctor: {
				//doctor data
				create: {
					name: payload.user.name,
					email: payload.user.email,
					...payload.doctor,
					address: payload.doctor.address ?? "",
					resume: resumeUploadResult.secure_url,
					resumePublicId: resumeUploadResult.public_id,
					additionalFiles: additionalFilesUploadResult.map((file) => ({
						url: file.secure_url,
						publicId: file.public_id,
					})),
				},
			},
		},
		include: {
			doctor: true,
		},
	});

	// ------------------------------OTP SET ------------------

	const expirationSeconds = 60 * 60;
	const otpKey = `doctor-application-otp:${payload.user.email}`;
	const otpvalue = crypto.randomInt(100000, 1000000).toString();

	// redisclient lib foulder থেকে আসতেছে এবং OTP Set করছি
	await redisclient.set(otpKey, otpvalue, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	//-------------------------- Email send ----------------------

	// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
	const tempatePath = path.join(
		process.cwd(),
		"src/app/templates/forgot-password.ejs",
	);

	// email massage temp formet / playload থেকে ডাটা নিয়ে বসাচ্ছি
	const templateData = {
		name: payload.user.name,
		email: payload.user.email,
		otp: otpvalue, // OTP এখানে যেভাবে লিখবো templates/forgot-password.ejs এ সেইম থাকবে
		expirationMinutes: expirationSeconds / 60,
	};

	const html = await ejs.renderFile(tempatePath, templateData);

	// Password Change করলে Gmail এ email যাবে
	await transporter.sendMail({
		// env config file থেকে আসতেছে
		from: config.email_sender,
		to: payload.user.email,
		subject: "Doctor Application - Email Verification",
		html,
	});

	return doctorApplication;
};

const verifyDoctorEmail = async (payload: IVerifyDoctorEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const existingUser = await prisma.user.findUnique({
		where: { email, role: Role.DOCTOR },
	});

	if (!existingUser) {
		throw new Error("Doctor Application Not Found.please Apply Again.");
	}

	if (!existingUser.emailVerified) {
		throw new Error("Email Already Verified");
	}

	const otpKey = `doctor-application-otp:${email}`; // email payload থেকে আসছে
	const redisOtp = await redisclient.get(otpKey);

	if (!redisOtp) {
		throw new Error(
			"OTP Expired.You Appliction Window Has Closed,Please Apply Again.",
		);
	}

	// redis থেকে পাওয়া OTP !== payload থেকে পাওয়া OTP ম্যাচ করা হচ্ছে
	if (redisOtp !== otp) {
		throw new Error("OTP Does Not Match");
	}

	// Otp Delete করবো
	await redisclient.del(otpKey);

	const verifiedUser = await prisma.user.update({
		where: { id: existingUser.id },
		data: { emailVerified: true },
		omit: { password: true },
		include: { doctor: true },
	});

	return verifiedUser;
};

const approveDoctor = async (
	payload: IApproveDoctorPayload,
	reviewer: RequestUser,
) => {
	const { doctorId, verificationStatus, rejectionReason } = payload;

	const existingDoctor = await prisma.doctor.findUnique({
		where: { id: doctorId },
		include: { user: true },
	});

	if (!existingDoctor) {
		throw new Error("Doctor Application Not Found");
	}

	if (!existingDoctor.isDeleted) {
		throw new Error("Doctor Application has Been Delete");
	}

	if (!existingDoctor.user.emailVerified) {
		throw new Error(
			"Doctor Hos Not Verified Their Email Yet.Application Cannot Be Reviewed.",
		);
	}

	if (existingDoctor.verificationStatus !== DoctorVerificationStatus.PANDING) {
		throw new Error(
			`Doctor Application Has Already Been ${existingDoctor.verificationStatus.toLowerCase()}`,
		);
	}

	if (
		verificationStatus === DoctorVerificationStatus.REJECTED &&
		!rejectionReason
	) {
		throw new Error(
			// httpStatus.BAD_REQUEST,
			"Rejection Reason Is Required When Rejecting A Doctor Application",
		);
	}

	// Approve Data Update
	const updatedDoctor = await prisma.doctor.update({
		where: { id: doctorId },
		data: {
			verificationStatus,
			rejectionReason:
				verificationStatus === DoctorVerificationStatus.REJECTED
					? rejectionReason
					: null,
			reviewedBy: reviewer.userId, //যে Admin doctor request accept করবে তার নাম এখানে দেখাবে
			reviewedAt: new Date(), // এবং তারিখ দেখাবে
		},
	});

	// -----------------------Email send ------------------
	// Doctor application Reject or Approve হলে Email যাবে

	const isApproved = verificationStatus === DoctorVerificationStatus.APPROVED;
	// যদি doctor account Approve হয় তাহলে doctor-approved-application.ejs যাবে
	// তা না হলে Rejected হবে এবং  doctor-Rejected-application.ejs যাবে
	const tempatePath = path.join(
		process.cwd(),
		`src/app/templates/${
			isApproved
				? "doctor-approved-application.ejs"
				: "doctor-rejected-application.ejs"
		}`,
	);

	const templateData = {
		name: updatedDoctor.name,
		reason: updatedDoctor.rejectionRespon,
	};

	const html = await ejs.renderFile(tempatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: updatedDoctor.email,
		subject: isApproved
			? "Your Doctor Application Has Been Approved"
			: "Your Doctor Application Has Been Rejected",
		html,
	});

	return updatedDoctor;
};

const getAllDoctors = async (query: IPostQuery) => {
	
	// search ,filter,pagination,sorting
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: DoctorWhereInput[] = []; //DoctorWhereInput from prisma

	//Searching-----------------------------------------------------
	// যদি user কোনো searchTerm দেয়
	if (query.searchTerm) {
		// AND condition-এর মধ্যে একটি OR condition যোগ করছি
		andConditions.push({
			OR: [
				//name or email দিয়ে সার্চ করছি
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
				{
					//specialization দিয়ে সার্চ করছি
					specialization: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
				{
					//licenseNumber দিয়ে সার্চ করছি
					licenseNumber: {
						contains: query.searchTerm,
						mode: "insensitive",
					},
				},
			],
		});
	}

	//filtering------------------------------------------------------

	// Specialization দিয়ে filter
	if (query.specialization) {
		andConditions.push({
			//mode: "insensitive",বড়/ছোট হাতের অক্ষর আলাদা করবে না
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	// Email দিয়ে filter
	if (query.email) {
		andConditions.push({
			email: { contains: query.email, mode: "insensitive" },
		});
	}

	// License Number দিয়ে filter
	if (query.licenseNumber) {
		andConditions.push({
			// License number পুরোপুরি একই হতে হবে
			licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
		});
	}

	// Verification Status দিয়ে filter
	if (query.verificationStatus) {
		andConditions.push({
			verificationStatus: query.verificationStatus as DoctorVerificationStatus,
		});
	}

	// delete doctor কে ফিরিয়ে আনার ফাংশন
	// if (query.isDeleted) {
	// 	andConditions.push({isDeleted:query.isDeleted ==="true"? true:false});
	// }

	// যেসব delete হয়েছে সেগুলো আর দেখাবে না।
	andConditions.push({ isDeleted: false });

	const allDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions.length > 0 ? andConditions : undefined,
		},
		// Pagination
		take: limit,
		skip: skip,

		// Sorting
		orderBy: {
			// sortBy : sortOrder
			[sortBy]: sortOrder,
		},

		include: {
			user: {
				omit: {
					password: true,
				},
			},

			// schedules: true,
			// appointments: true
			// prescriptions: true
		},
	});

	const totalDoctorCount = await prisma.doctor.count({
		where: {
			AND: andConditions,
		},
	});

	return {
		data: allDoctors,
		meta: {
			page: page,
			limit: limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit),
		},
	};
};

const updateDoctorProfile=async(payload:IUpdateDoctorProfilePayload,user:RequestUser)=>{
	const existingDoctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!existingDoctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const updatedDoctor = await prisma.doctor.update({
		where: { id: existingDoctor.id },
		data: payload,
	});

	return updatedDoctor;
}

const getAvailableDoctorByTodaysSchedule = async (query: IPostQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const now = new Date();
	const startOfToday = startOfDay(now);
	const startOfTomorrow = addDays(startOfToday, 1);

	// A doctor is "available today" if they have at least one published,
	// not-yet-started schedule today with open slots left.

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ verificationStatus: DoctorVerificationStatus.APPROVED },
		{
			schedules: {
				some: {
					isDeleted: false,
					status: Schedulestatus.PUBLISHED,
					availableslots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				} } },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const availableDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
			schedules: {
				where: {
					isDeleted: false,
					status: Schedulestatus.PUBLISHED,
					availableSlots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				},
				orderBy: { [sortBy] : sortOrder },
				select: {
					id: true,
					startDateTime: true,
					endDateTime: true,
					availableSlots: true,
					totalSlots: true,
				},
			},
		},
	});

	const totalAvailableDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: availableDoctors,
		meta: {
			page,
			limit,
			total: totalAvailableDoctorCount,
			totalPages: Math.ceil(totalAvailableDoctorCount / limit),
		},
	};
}

const getAllDoctorsListPublic = async (query: IPostQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ verificationStatus: DoctorVerificationStatus.APPROVED },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
				{ qualifications: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const allDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
		},
	});

	const totalDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: allDoctors,
		meta: {
			page,
			limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit),
		},
	};
}

const getSingleDoctorPublicProfile = async (doctorId: string) => {

	const doctor = await prisma.doctor.findUnique({
		where: {
			id: doctorId,
			isDeleted: false,
			verificationStatus: DoctorVerificationStatus.APPROVED,
		},
		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
		},
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Not Found");
	}

	return doctor;
}


export const DoctorService = {
	applyAsDoctor,
	verifyDoctorEmail,
	approveDoctor,
	getAllDoctors,
	updateDoctorProfile,
	getAvailableDoctorByTodaysSchedule,
	getAllDoctorsListPublic,
	getSingleDoctorPublicProfile
};
