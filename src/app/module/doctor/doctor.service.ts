import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma";
import { cloudinary } from "../../lib/cloudinary";
import { name } from "ejs";
import bcrypt from "bcryptjs";
import config from "../../config";
import { Role } from "../../../generated/prisma/enums";

const applyAsDoctor = async (
	payload: any,
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
					resume: resumeUploadResult.secure_url,
					resumePublicId: resumeUploadResult.public_id,
					additionalFiles: additionalFilesUploadResult.map((file) => ({
						url: file.secure_url,
						publicId: file.public_id,
					})),
				},
			},
		},
	});
	return doctorApplication;
};

export const DoctorService = {
	applyAsDoctor,
};
