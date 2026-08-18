import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";

const bookAppointment = async () => {
	// business logic

	const bkashIdToken = await getBkashIdToken(); // lib থেকে আসছে

	if (!bkashIdToken) {
		throw new Error("No Bkash Access Token Found!!");
	}
	// copy  /tokenized/checkout/create
	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json", //copy web
				Authorization: bkashIdToken, //line 7
				"X-App-Key": config.bkash_app_key, // env
			},
			body: JSON.stringify({
				// copy for ewbsite
				// agreementID: "TokenizedMerchant01L3IKB6H1565072174986", // appointment id
				mode: "0011",
				payerReference: "01723888888", //user email or phone number
				callbackURL: `${config.bkash_base_url}/appointment/book-appointment/payment/callback`,
				merchantAssociationInfo: "MI05MID54RF09123456One",
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: "Inv0124", // appointment id
			}),
		},
	);

	const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json();

	return bkashCreatePaymentResult;
};

export const AppointmentServices = {
	bookAppointment,
};
