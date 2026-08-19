import config from "../config";
import { redisclient } from "./redis";

export const getBkashIdToken = async () => {
	try {
		// Redis-এ টোকেন সেভ রাখার জন্য key নাম ঠিক করা হচ্ছে
		const IdTokenkey = "bkash:idToken";
		const RefreshTokenkey = "bkash:refreshToken";

		// Redis থেকে আগে থেকে সেভ করা ID Token আনা হচ্ছে (যদি থাকে)
		let bkashIdToken = await redisclient.get(IdTokenkey);

		// ID Token-এর মেয়াদ আর কত সেকেন্ড বাকি আছে (TTL = Time To Live), সেটা চেক করা হচ্ছে
		const bkashIdTokenTTL = await redisclient.ttl(IdTokenkey);

		// একইভাবে Refresh Token আর তার মেয়াদ (TTL) আনা হচ্ছে
		const bkashRefreshToken = await redisclient.get(RefreshTokenkey);
		const bkashRefreshTokenTTL = await redisclient.ttl(RefreshTokenkey);

		// ডিবাগিং-এর জন্য সব ভ্যালু কনসোলে প্রিন্ট করা হচ্ছে
		console.log({
			bkashIdToken,
			bkashIdTokenTTL,
			bkashRefreshToken,
			bkashRefreshTokenTTL,
		});

		// ============ কেস ১: টোকেন রিফ্রেশ করার সময় হয়ে গেছে ============
		// শর্ত: (ID Token নেই অথবা এর মেয়াদ ৬০০ সেকেন্ডের কম বাকি আছে)
		//       এবং ID Token-এর মেয়াদ আসলেই ৬০০ সেকেন্ডের কম/সমান
		//       এবং Refresh Token আছে
		//       এবং Refresh Token-এর মেয়াদ ৬০০ সেকেন্ডের বেশি বাকি আছে (মানে refresh token দিয়ে কাজ চালানো যাবে)
		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashIdTokenTTL <= 600 &&
			bkashRefreshToken &&
			bkashRefreshTokenTTL > 600
		) {
		// ------------------------------------------------------------------Refresh token-----------------------------------------------------------
			const refreshTokenresponse = await fetch(
				// tokenized/checkout/token/grant কপি করছি https://developer.bka.sh/docs/grant-token-3
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_app_secret,
						refresh_token: bkashRefreshToken, // পুরনো refresh token পাঠানো হচ্ছে
					}),
				},
			);

			// Refresh Token না পাওয়া গেলে Error দিবে
			if (!refreshTokenresponse.ok) {
				throw new Error("Bkash Access Token Grant Failed");
			}

			// bKash থেকে পাওয়া refreshTokenresponse json এ কনভার্ট
			const bkashRefreshTokenResult = await refreshTokenresponse.json();
			console.log("BKASH REFRESH RESPONSE:", bkashRefreshTokenResult);

			// রিফ্রেশ Token দিয়ে পাওয়া id_token উপরের ভ্যারিয়েবলে রাখা হচ্ছে
			bkashIdToken = bkashRefreshTokenResult.id_token as string;
			console.log("NEW ID TOKEN:", bkashIdToken);


			// Refresh Token মেয়াদ শেষ হওয়ার আগে আবার নতুন করে আবার 1 ঘন্টার জন্য রিফ্রিশ Token Redis-এ Set করা হচ্ছে
			await redisclient.set(IdTokenkey, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60,
				},
			});

			// নতুন টোকেনটি Return যাচ্ছে
			return bkashIdToken;
		}

		// ============ কেস ২: এখনো পুরনো ID Token ভ্যালিড আছে ============
		// যদি ID Token-এর মেয়াদ ৬০০ সেকেন্ডের বেশি বাকি থাকে,
		// তাহলে নতুন কিছু করার দরকার নেই — পুরনোটাই রিটার্ন করে দেওয়া হচ্ছে
		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		// ============ কেস ৩: কোনো ভ্যালিড টোকেনই নেই (একদম প্রথমবার / দুটোরই মেয়াদ শেষ) ============
		// এখানে bKash-এর "token grant" API কল করে একদম নতুন করে
		// ID Token আর Refresh Token — দুটোই নেওয়া হচ্ছে (fresh login-এর মতো)
		// tokenized/checkout/token/grant কপি করছি https://developer.bka.sh/docs/grant-token-3
		const response = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_app_secret,
				}),
			},
		);

		if (!response.ok) {
			throw new Error("Bkash Access Token Grant Failed");
		}
       
		// নতুন Token বানানোর ফাংশনটি Json এ কনভার্ট করা হচ্ছে
		const result = await response.json();

		//-------------- Bkash New token Set---------------
		await redisclient.set(IdTokenkey, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60, // 1 hour
			},
		});

		// ---------------Refresh New Token Set--------------------------

		await redisclient.set(RefreshTokenkey, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28, // 28 days
			},
		});

		// উপরের ভ্যারিয়েবলে আবার নতুন token জমা হচ্ছে
		bkashIdToken = result.id_token;

		return bkashIdToken;
	} catch (error: any) {
		throw new Error(error.message);
	}
};
