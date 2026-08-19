import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";

//----- STEP 1: Appointment Book করার জন্য bKash Payment তৈরি করা-------------

const bookAppointment = async () => {
	// এখানে appointment-এর অন্যান্য business logic থাকবে
	// যেমন:
	// - Doctor খোঁজা
	// - Appointment তৈরি করা
	// - Amount নির্ধারণ করা
	// ইত্যাদি

	// STEP 2: Redis থেকে valid bKash ID Token নেওয়া হচ্ছে
	// getBkashIdToken() ফাংশন lib থেকে পাই
	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		throw new Error("No Bkash Access Token Found!!");
	}

	// --------------------payment তৈরি করা হচ্ছে-------------------------------

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
				payerReference: "01723888888",
				// Payment শেষ হওয়ার পরে bKash এই URL-এ callback করবে (আমাদের বানানো রাউট)
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				// Merchant info
				merchantAssociationInfo: "MI05MID54RF09123456One",
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: "Inv0124", // Merchant-unique Number
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	return bkashCreatePaymentResult;
};
//------------------------ callback URL --------------------------------------

// Customer payment করার পর bKash আমাদের callback URL-এ paymentID, status ও signature সহ request
// পাঠায়, যা queary object-এর মধ্যে পাওয়া যায়।

const bookAppointmentCallback = async (queary: Record<string, any>) => {
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

	// --------------------- bKash Execute Payment API call ----------------------

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
				paymentID: paymentID,
			}),
		},
	);

	// ------------------------ Executed Payment Result ---------------------------

	// এই অংশটার মূল কাজ হলো bKash payment শেষ হওয়ার পরে customer-কে Frontend-এর
	// নির্দিষ্ট page-এ পাঠানোর জন্য URL তৈরি করা।

	const executedPaymentResult = await executedPaymentResponse.json();
	console.log(executedPaymentResult);

	if (status === "success") {
		return {
			executedPaymentResult,
			redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
		};
	}

	if (status === "failure") {
		return {
			executedPaymentResult,
			redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=fail`,
		};
	}

	if (status === "cancel") {
		return {
			executedPaymentResult,
			redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
		};
	}

	return {
		executedPaymentResult,
		redirecUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
	};
};

export const AppointmentServices = {
	bookAppointment,
	bookAppointmentCallback,
};
