import config from "../config";
import { redisclient } from "./redis";

export const getBkashIdToken = async () => {
	try {
		// =========================================================
		// STEP 1: Redis-এর জন্য ID Token এবং Refresh Token-এর Key তৈরি
		// =========================================================
		const IdTokenkey = "bkash:idToken";
		const RefreshTokenkey = "bkash:refreshToken";

		// =========================================================
		// STEP 2: Redis থেকে ID Token এবং তার TTL বের করা
		//
		// bkashIdToken     → Redis-এ থাকা বর্তমান ID Token
		// bkashIdTokenTTL  → ID Token আর কত সেকেন্ড valid থাকবে
		//
		// TTL:
		// - > 600  → ১০ মিনিটের বেশি সময় বাকি
		// - <= 600 → ১০ মিনিট বা তার কম সময় বাকি
		// - -2     → Redis-এ Key নেই
		// =========================================================
		let bkashIdToken = await redisclient.get(IdTokenkey);
		const bkashIdTokenTTL = await redisclient.ttl(IdTokenkey);

		// =========================================================
		// STEP 3: Redis থেকে Refresh Token এবং তার TTL বের করা
		//
		// bkashRefreshToken     → Redis-এ থাকা Refresh Token
		// bkashRefreshTokenTTL  → Refresh Token আর কত সেকেন্ড valid থাকবে
		// =========================================================
		const bkashRefreshToken = await redisclient.get(RefreshTokenkey);
		const bkashRefreshTokenTTL = await redisclient.ttl(RefreshTokenkey);

		// বর্তমানে Redis-এ Token এবং তাদের TTL কী আছে সেটা দেখার জন্য
		console.log({
			bkashIdToken,
			bkashIdTokenTTL,
			bkashRefreshToken,
			bkashRefreshTokenTTL,
		});

		// =========================================================
		// STEP 4: ID Token-এর মেয়াদ ১০ মিনিট বা তার কম হলে
		// এবং Refresh Token valid থাকলে
		//
		// Refresh Token ব্যবহার করে নতুন ID Token নেওয়া হবে।
		// =========================================================
		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashIdTokenTTL <= 600 &&
			bkashRefreshToken &&
			bkashRefreshTokenTTL > 600
		) {
			// ---------------------------------------------------------
			// STEP 4.1: bKash Refresh Token API-তে request পাঠানো হচ্ছে
			// Refresh Token ব্যবহার করে নতুন ID Token নেওয়ার জন্য
			// ---------------------------------------------------------
			const refreshTokenresponse = await fetch(
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
						refresh_token: bkashRefreshToken,
					}),
				},
			);

			// ---------------------------------------------------------
			// STEP 4.2: bKash API request সফল হয়েছে কিনা যাচাই করা
			// ---------------------------------------------------------
			if (!refreshTokenresponse.ok) {
				throw new Error("Bkash Access Token Grant Failed");
			}

			// ---------------------------------------------------------
			// STEP 4.3: bKash থেকে পাওয়া response JSON-এ convert করা
			// এবং নতুন ID Token বের করা
			// ---------------------------------------------------------
			const bkashRefreshTokenResult = await refreshTokenresponse.json();
			console.log("BKASH REFRESH RESPONSE:", bkashRefreshTokenResult);

			bkashIdToken = bkashRefreshTokenResult.id_token as string;
			console.log("NEW ID TOKEN:", bkashIdToken);

			// ---------------------------------------------------------
			// STEP 4.4: নতুন ID Token Redis-এ ১ ঘণ্টার জন্য সংরক্ষণ করা
			// ---------------------------------------------------------
			await redisclient.set(IdTokenkey, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60,
				},
			});

			// ---------------------------------------------------------
			// STEP 4.5: নতুন ID Token return করা
			// ---------------------------------------------------------
			return bkashIdToken;
		}

		// =========================================================
		// STEP 5: ID Token-এর মেয়াদ ১০ মিনিটের বেশি থাকলে
		//
		// নতুন Token নেওয়ার কোনো প্রয়োজন নেই।
		// Redis থেকে পাওয়া পুরোনো ID Token-ই return করা হবে।
		// =========================================================
		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		// =========================================================
		// STEP 6: ID Token ব্যবহারযোগ্য নয় এবং Refresh Token দিয়েও
		// নতুন ID Token নেওয়া সম্ভব নয়।
		//
		// তাই bKash Grant Token API ব্যবহার করে
		// নতুন ID Token এবং Refresh Token নেওয়া হবে।
		// =========================================================

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

		// =========================================================
		// STEP 7: bKash Grant Token API request সফল হয়েছে কিনা যাচাই
		// =========================================================
		if (!response.ok) {
			throw new Error("Bkash Access Token Grant Failed");
		}

		// =========================================================
		// STEP 8: bKash-এর response JSON-এ convert করা
		//
		// result.id_token
		//      → নতুন ID Token
		//
		// result.refresh_token
		//      → নতুন Refresh Token
		// =========================================================
		const result = await response.json();

		// =========================================================
		// STEP 9: নতুন ID Token Redis-এ ১ ঘণ্টার জন্য সংরক্ষণ করা
		// =========================================================
		await redisclient.set(IdTokenkey, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60, // 1 hour
			},
		});

		// =========================================================
		// STEP 10: নতুন Refresh Token Redis-এ ২৮ দিনের জন্য সংরক্ষণ করা
		// =========================================================
		await redisclient.set(RefreshTokenkey, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28, // 28 days
			},
		});

		// =========================================================
		// STEP 11: নতুন ID Token variable-এ রেখে
		// সেটি return করা
		// =========================================================
		bkashIdToken = result.id_token;

		return bkashIdToken;
	} catch (error: any) {
		// =========================================================
		// STEP 12: কোনো Error হলে Error Message সহ throw করা
		// =========================================================
		throw new Error(error.message);
	}
};