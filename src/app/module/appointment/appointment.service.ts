import {
	AppointmentStatus,
	PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";

//----- 01-Appointment Book bKash Payment ---------
// payload:any,user:Request পরে যুক্ত হবে
const bookAppointment = async (payload: any, user: RequestUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		//-------------------------business logic (sTART)----------------------
		//----------------------step 03 appointment create---------------------
		const appointment = await tx.appointment.create({
			data: {
				status: AppointmentStatus.PENDING,
				// পরে যুক্ত হবে Doctor ID parient-ID
			},
		});
		//-------------------------Step 01----------------------
		// Redis থেকে valid bKash ID Token নেওয়া হচ্ছে
		// getBkashIdToken() ফাংশন lib থেকে পাই
		const bkashIdToken = await getBkashIdToken();

		if (!bkashIdToken) {
			throw new Error("No Bkash Access Token Found!!");
		}
		// --------------------step:02 payment তৈরি করা হচ্ছে-----------------------------
		const bkashCreatePaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/create`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken, // bKash ID Token
					"X-App-Key": config.bkash_app_key, // env bKash App Key
				},
				// bKash-কে payment সম্পর্কিত তথ্য পাঠানো হচ্ছে
				body: JSON.stringify({
					mode: "0011",
					// payerReference: "01723888888", //user email or number
					payerReference: user.email, //payload auth check থেকে আসতেছে
					// Payment শেষ হওয়ার পরে bKash এই URL-এ callback করবে (আমাদের বানানো রাউট)
					callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
					amount: "1200",
					currency: "BDT",
					intent: "sale",
					// merchantInvoiceNumber: "Inv0124", // appointment id
					merchantInvoiceNumber: appointment.id,
				}),
			},
		);

		const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

		// ------------------------STEP:04 payment model create -------------------------

		await tx.payment.create({
			data: {
				// data base tabile আছে
				merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
				appointmentID: appointment.id,
				amount: "1200",
				gatewayResponse: bkashCreatePaymentResult,
				bkashPaymentId: bkashCreatePaymentResult.paymentID,
				payerReferance: user.email,
			},
		});

		return {
			paymentUrl: bkashCreatePaymentResult.bkashURL, //আসছে bKash নিজে থেকে
		};
	});

	return transactionResult;
};

//------03-cancel pay Api-------------------------
const payAppointment = async (payload: any, user: RequestUser) => {
	const appoindmentID = payload.appointmentId;

	const existingAppointment = await prisma.appointment.findUnique({
		where: {
			id: appoindmentID,
		},
	});

	if (!existingAppointment) {
		throw new Error("Appoint id not existing");
	}

	if (existingAppointment.status !== "PENDING") {
		throw new Error("Appointment Is Not Pending");
	}

	const bkashIdToken = await getBkashIdToken(); // from lib

	if (!bkashIdToken) {
		throw new Error("No Bkash Access Token Found!!");
	}
	// --------------------step:02 payment তৈরি করা হচ্ছে-----------------------------
	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken, // bKash ID Token
				"X-App-Key": config.bkash_app_key, // env bKash App Key
			},
			// bKash-কে payment সম্পর্কিত তথ্য পাঠানো হচ্ছে
			body: JSON.stringify({
				mode: "0011",
				// payerReference: "01723888888", //user email or number
				payerReference: user.email, //payload auth check থেকে আসতেছে
				// Payment শেষ হওয়ার পরে bKash এই URL-এ callback করবে (আমাদের বানানো রাউট)
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				// merchantInvoiceNumber: "Inv0124", // appointment id
				merchantInvoiceNumber: existingAppointment.id,
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	await prisma.payment.update({
		where: {
			appointmentID: existingAppointment.id,
		},
		data: {
			// data base tabile আছে
			merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
			gatewayResponse: bkashCreatePaymentResult,
			bkashPaymentId: bkashCreatePaymentResult.paymentID,
		},
	});
	return {
		paymentUrl: bkashCreatePaymentResult.bkashURL, //আসছে bKash নিজে থেকে
	};
};

//------02-Roleback Function-------------------

// Customer payment করার পর bKash আমাদের callback URL-এ paymentID, status ও signature সহ request
// পাঠায়, যা queary object-এর মধ্যে পাওয়া যায়।
const bookAppointmentCallback = async (queary: Record<string, any>) => {
	const transActionRoleBack = await prisma.$transaction(async (tx) => {
		// STEP 7: Callback থেকে paymentID নেওয়া
		const paymentID = queary.paymentID;

		if (!paymentID) {
			throw new Error("Payment id Missing");
		}

		const status = queary.status;

		if (!status) {
			throw new Error("Payment status is Missing");
		}

		const bkashIdToken = await getBkashIdToken(); // lib ফাইল

		if (!bkashIdToken) {
			throw new Error("No Bkash Access Token Found!");
		}

		// --------------------- bKash Execute Payment API call

		// Customer payment করার পর সেই payment সম্পন্ন করার জন্য Execute Payment API call করা হয়।

		const executedPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/execute`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken, //from lib
					"X-App-Key": config.bkash_app_key,
				},
				body: JSON.stringify({
					paymentID: paymentID, //আসছে bKash নিজে থেকে
				}),
			},
		);

		// ------------------------ Executed Payment Result

		// এই অংশটার মূল কাজ হলো bKash payment শেষ হওয়ার পরে customer-কে Frontend-এর
		// নির্দিষ্ট page-এ পাঠানোর জন্য URL তৈরি করা।

		const executedPaymentResult = await executedPaymentResponse.json();

		if (status === "success") {
			// business logic Database Update
			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
				},
			});

			await tx.payment.update({
				where: {
					bkashPaymentId: paymentID,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxId: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					gatewayResponse: executedPaymentResult,
				},
			});

			return {
				executedPaymentResult,
				redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
			};
		} else if (status === "failure") {
			await tx.payment.update({
				where: {
					appointmentID: executedPaymentResult.merchantInvoiceNumber,
					bkashTrxId: paymentID,
				},
				data: {
					status: PaymentStatus.FAILED,
					gatewayResponse: executedPaymentResult,
				},
			});

			return {
				executedPaymentResult,
				redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=failue`,
			};
		} else if (status === "cancel") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentID,
				},
				data: {
					status: PaymentStatus.CANCELLED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				executedPaymentResult,
				redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
			};
		} else {
			return {
				executedPaymentResult,
				redirecUrl: `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`,
			};
		}
	});

	return transActionRoleBack;
};

//------04-Cancel Appointment---------------------
const cancelAppointment = async (payload: any) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const appointmentId = payload.appointmentid;

		const existingAppointment = await tx.appointment.findUnique({
			where: {
				id: appointmentId,
			},
			// true করার জন্য Paymentএর ডাটা Appointment এ পাবো
			include: {
				payment: true,
			},
		});

		if (!existingAppointment) {
			throw new Error("Appoint id not existing");
		}

		if (
			existingAppointment.status === "ONGOING" ||
			existingAppointment.status === "COMPLETED"
		) {
			throw new Error("Appointment Ongoing or Completed");
		}

		if (existingAppointment.status === "CANCELLED") {
			throw new Error("Appointment Alreday Cancelled");
		}

		const updatedAppointment = await tx.appointment.update({
			where: {
				id: existingAppointment.id,
			},
			data: {
				status: "CANCELLED",
			},
		});

		// refund payment
		// এখান থেকে Token টা নিলাম
		const bkashIdToken = await getBkashIdToken(); // from lib

		if (!bkashIdToken) {
			throw new Error("No Bkash Access Token Found!!");
		}

		const bkashRefundPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/payment/refund`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken, // bKash ID Token
					"X-App-Key": config.bkash_app_key, // env bKash App Key
				},
				// bKash-কে payment সম্পর্কিত তথ্য পাঠানো হচ্ছে
				body: JSON.stringify({
					paymentID: existingAppointment.payment?.bkashPaymentId,
					trxID: existingAppointment.payment?.bkashTrxId,
					amount: existingAppointment.payment?.amount.toString(),
					sku: "Appointment Cancellation",
					reason: "Pesent Cancelled The Appointment",
				}),
			},
		);

		const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();

		console.log(bkashRefundPaymentResult);

		const updatedPayment = await tx.payment.update({
			where: {
				appointmentID: existingAppointment.id,
			},
			data: {
				// refundTrxId bkash build in
				refundTrxId: bkashRefundPaymentResult.refundTrxID,
				refundedAt: bkashRefundPaymentResult.completedTime,
				refundAmount: bkashRefundPaymentResult.amount,
				refundReason: "Patient Cancelled The Appointment",
				status: PaymentStatus.REFUNDED,
				gatewayResponse: bkashRefundPaymentResult,
			},
		});

		return {
			appointment: updatedAppointment,
			payment: updatedPayment,
		};
	});

	return transactionResult;
};

export const AppointmentServices = {
	bookAppointment,
	payAppointment,
	bookAppointmentCallback,
	cancelAppointment,
};
