import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterPatientPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";
import { googleclient } from "../../lib/googleAuth_ID";
import crypto from "crypto";
import { redisclient } from "../../lib/redis";
import { transporter } from "../../lib/nodemailler";
import ejs from "ejs";
import path from "path";
import { TokenPayload } from "google-auth-library";
import { AppError } from "../../utils/appError";
import httpStatus from "http-status"

const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password, patient: patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, 8);

	// ----------OTP Redise এ সেট------------

	const expirationMinutes = 5 * 60; // টাইমটা বলেদিতেছে কতো মিনিট থাকবে OTP
	const otpkey = `patient-registration-otp:${email}`;
	const otpValue = crypto.randomInt(100000, 1000000).toString(); // crypto দিয়ে Random OTP বানাচ্ছি

	// redisclient lib foulder থেকে আসতেছে এবং clien email and OTP  Set করছি
	await redisclient.set(otpkey, otpValue, {
		expiration: {
			type: "EX",
			value: expirationMinutes,
			//   উপরের variable থেকে আসতেছে
		},
	});

	// ----------client data ------------

	const patientRegistrationKey = `patient-registration-data:${email}`;

	// client data গুলো payload user থেকে আসতেছে
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		patient: patientData,
	};

	// client DATA রেডিসে Set করছি /redisclient lib থেকে আসতেছে
	await redisclient.set(
		patientRegistrationKey,
		JSON.stringify(redisUserDataPayload),
		{
			// redis এর ডাটা stringify অবস্থায় থাকে ,তাই Object কে stringify করছি
			expiration: {
				type: "EX",
				value: expirationMinutes,
			},
		},
	);

	// ------------------------------  Email Send -----------------------------------------

	// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
	const tempatePath = path.join(
		process.cwd(),
		"src/app/templates/registation-user-otp.ejs",
	);

	// email massage temp formet
	const templateData = {
		name,
		email,
		otpValue, // OTP এখানে যেভাবে লিখবো templates/forgot-password.ejs এ সেইম থাকবে
		expirationMinutes: expirationMinutes / 60,
	};

	const html = await ejs.renderFile(tempatePath, templateData);

	// এখানে Email Verification-এর জন্য email এ OTP পাঠানো হচ্ছে।
	await transporter.sendMail({
		// env config file থেকে আসতেছে
		from: config.email_sender,
		to: email,
		subject: "Email Verification",
		html,
	});
};

const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLocaleLowerCase();

	//   client email database আছে কি না
	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExist?.status === "BLOCKED") {
		throw new Error("User is Blocked");
	}

	if (isUserExist?.emailVerified) {
		throw new Error("Email ALready Verified");
	}

	if (isUserExist?.isDeleted || isUserExist?.status === "DELETED") {
		throw new Error("User is Deleted");
	}

	const otpkey = `patient-registration-otp:${email}`;
	// redisclient lib foulder থেকে আসতেছে এবং redios থেকে otp get করা হচ্ছে
	const redisOtp = await redisclient.get(otpkey);

	if (!redisOtp) {
		throw new Error("Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new Error("OTP Does Not Match");
	}

	// auto delete হবে otp
	await redisclient.del(otpkey);

	const patientRegistrationKey = `patient-registration-data:${email}`;
	// redisclient lib foulder থেকে আসতেছে এবং redios থেকে USER Data get করা হচ্ছে
	const redisPatientData = await redisclient.get(patientRegistrationKey);

	if (!redisPatientData) {
		throw new Error("Patient Doesnt Exist");
	}

	const patientPayload: IRegisterPatientPayload = JSON.parse(redisPatientData);

	// এখান থেকে Data ডাটাবেইজে পাঠাচ্ছি
	const createdUser = await prisma.user.create({
		data: {
			name: patientPayload.name,
			email: patientPayload.email,
			password: patientPayload.password,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			patient: {
				create: {
					name: patientPayload.name,
					email: patientPayload.email,
					contactNumber: patientPayload?.patient?.contactNumber || null,
				},
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	// auto delete হবে email
	await redisclient.del(patientRegistrationKey);

	// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
	const tempatePath = path.join(
		process.cwd(),
		"src/app/templates/patient-welcome-email.ejs",
	);

	// email massage temp formet
	const templateData = {
		name: createdUser.name,
	};

	const html = await ejs.renderFile(tempatePath, templateData);

	// Password Change করলে Gmail এ email যাবে
	await transporter.sendMail({
		// env config file থেকে আসতেছে
		from: config.email_sender,
		to: email,
		subject: "Wellcome To PH Healthcare System",
		html,
	});

	// createdUser object থেকে patient আলাদা করে নেওয়া, আর বাকি সব property user object-এর মধ্যে রাখা।
	const { patient, ...user } = createdUser;
	// এই ফাইলটা accessToken এবং refreshToken এ যাচ্ছে
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	// jwtUtils Utils ফাইল থেকে আসতেছে
	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	// jwtUtils Utils ফাইল থেকে আসতেছে
	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		patient,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND,"user Not Found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new Error(
			"User already registered with Google, please login with Google",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new Error("Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

// Frontend-এ Login করা User তার নিজের Profile Data দেখার জন্য এটা বানানো
const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			patient: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new Error("User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new Error(
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new Error("User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

// Google Login Fuction
const googleLogin = async (payload: IGoogleLoginPayload) => {
	//  google-auth-library থেকে TokenPayload পাই
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	//  Check করা হচ্ছে Token-টি আমাদের Application-এর জন্যই তৈরি হয়েছে কি না।
	try {
		//googleclient lib থেকে পাই
		const ticket = await googleclient.verifyIdToken({
			idToken: payload.idToken, //Frontend থেকে পা
			audience: config.google_client_id, //env থেকে পাই
		});
		googleIdTokenPayload = ticket.getPayload(); //(getPayload)google-auth-library
	} catch (error) {
		console.log("Google Id Token verification error:", error);
		throw new Error("Invalid Google ID Token");
	}

	if (!googleIdTokenPayload) {
		throw new Error("Invalid Google ID Token payload");
	}

	if (!googleIdTokenPayload.email) {
		throw new Error("Email not found in Google ID Token payload");
	}
	if (!googleIdTokenPayload.name) {
		throw new Error("Name not found in Google ID Token payload");
	}
	//check Database এ আগে থেকে user আছে কি
	const ifPatientExistsWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.PATIENT,
			googleId: googleIdTokenPayload.sub,
		},
	});

	//  থাকলে user কে এখানে রাখবো
	let user = ifPatientExistsWithGoogleAuth;

	// যদি Google Accoutnt নাই কিন্তু Credential Account ‍থাকতে পারে
	if (!ifPatientExistsWithGoogleAuth) {
		// তাই এখানে আবার ডাটাবেইসে chack দিবো Credential Account আছে কি না
		// if থাকে Credential Account এর সাথে google account যুক্ত করবো
		// else না থাকলে নতুন একাউন্ট বানাবো
		const ifpatientExistWithCredential = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.PATIENT,
				authProvider: AuthProvider.CREDENTIALS,
			},
		});

		if (ifpatientExistWithCredential) {
			if (!ifpatientExistWithCredential.emailVerified) {
				throw new Error(
					"Email is not verified, please verify your email first",
				);
			}

			if (ifpatientExistWithCredential.status === UserStatus.BLOCKED) {
				throw new Error("User is blocked");
			}
			if (
				ifpatientExistWithCredential.isDeleted ||
				ifpatientExistWithCredential.status === UserStatus.DELETED
			) {
				throw new Error("User is deleted");
			}
			// সব ঠিক থাকলে সেই Credential User-এর সাথে Google Account Connect করবো।
			user = await prisma.user.update({
				where: {
					//Credential id
					id: ifpatientExistWithCredential.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
				},
			});
		} else {
			// Google Registered user exists
			user = await prisma.user.create({
				data: {
					email: googleIdTokenPayload.email,
					name: googleIdTokenPayload.name,
					role: Role.PATIENT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					patient: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});

			//-----Google Register Auto Email Send----------------

			// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
			const tempatePath = path.join(
				process.cwd(),
				"src/app/templates/patient-welcome-email.ejs",
			);

			// email massage temp formet
			const templateData = {
				name: user.name,
				email: user.email,
			};

			const html = await ejs.renderFile(tempatePath, templateData);

			// Password Change করলে Gmail এ email যাবে
			await transporter.sendMail({
				// env config file থেকে আসতেছে
				from: config.email_sender,
				to: user.email,
				subject: "Email Verification",
				html,
			});
		}
	}

	// যদি Credential Account ‍ও না থাকে Google Accoutnt ও না থাকে
	if (!user) {
		throw new Error("User not found or created");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}
	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgetPassword = async (payload: IForgotPasswordPayload) => {
	const { email } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new Error("User Dose Not Exist");
	}

	if (isUserExist?.status === "BLOCKED") {
		throw new Error("user is Blocked");
	}

	if (!isUserExist.emailVerified) {
		throw new Error("User Not Verified");
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new Error("User is Deleted");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new Error("User Has Account with Google");
	}

	// crypto দিয়ে Random OTP বানিয়ে redis ডাটাবেইজে জমা করা হচ্ছে
	const otp = crypto.randomInt(100000, 1000000).toString();
	const key = `forgot-password-otp:${isUserExist.email}`;

	const expirationMinutes = 5 * 60; // টাইমটা বলেদিতেছে কতো মিনিট থাকবে OTP

	// redisclient lib foulder থেকে আসতেছে এবং OTP Set করছি
	await redisclient.set(key, otp, {
		expiration: {
			type: "EX",
			value: expirationMinutes,
		},
	});

	// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
	const tempatePath = path.join(
		process.cwd(),
		"src/app/templates/forgot-password.ejs",
	);

	// email massage temp formet
	const templateData = {
		name: isUserExist.name,
		otp, // OTP এখানে যেভাবে লিখবো templates/forgot-password.ejs এ সেইম থাকবে
		expirationMinutes: expirationMinutes / 60,
	};

	const html = await ejs.renderFile(tempatePath, templateData);

	// Password Change করলে Gmail এ email যাবে
	await transporter.sendMail({
		// env config file থেকে আসতেছে
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password",
		html,
	});
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!isUserExist) {
		throw new Error("User Dose Not Exist");
	}

	if (isUserExist?.status === "BLOCKED") {
		throw new Error("user is Blocked");
	}

	if (!isUserExist.emailVerified) {
		throw new Error("User Not Verified");
	}

	if (isUserExist.isDeleted || isUserExist.status === "DELETED") {
		throw new Error("User is Deleted");
	}

	if (isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new Error("User Has Account with Google");
	}

	//---------- Otp verify-------------

	const key = `forgot-password-otp:${isUserExist.email}`;
	// redisclient lib foulder থেকে আসতেছে
	const redisOtp = await redisclient.get(key);

	if (!redisOtp) {
		throw new Error("Invalid OTP");
	}

	if (redisOtp !== otp) {
		throw new Error("OTP Does Not Match");
	}

	const hashedNewPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);
	await prisma.user.update({
		where: {
			email: isUserExist.email,
		},
		data: {
			password: hashedNewPassword,
		},
	});

	// redisclient lib foulder থেকে আসতেছে
	await redisclient.del([key]);

	// যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম
	const tempatePath = path.join(
		process.cwd(),
		"src/app/templates/reset-Password.ejs",
	);
	// email massage temp formet
	const html = await ejs.renderFile(tempatePath, {
		name: isUserExist.name,
	});

	// Password Change করলে Gmail এ email যাবে
	await transporter.sendMail({
		// env config file থেকে আসতেছে
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Password Change",
		html,
	});
};

export const AuthService = {
	registerPatient,
	verifyPatientEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgetPassword,
	resetPassword,
};
