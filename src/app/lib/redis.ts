// import { createClient } from "redis";
// import config from "../config";

// // copy for redis SDK clients (website)v password forget OTP

// export const redisclient = createClient({
// 	username: config.redis_user,
// 	password: config.redis_password,
// 	socket: {
// 		host: config.redis_host,
// 		port: Number(config.redis_port),
// 	},
// });


import { createClient } from "redis";
import config from "../config";

// copy for redis SDK clients (website)v password forget OTP

export const redisclient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	socket: {
		host: config.redis_host,
		port: Number(config.redis_port),
		reconnectStrategy: (retries) => {
			// প্রতি রিট্রাইতে একটু একটু করে delay বাড়বে, সর্বোচ্চ ৫ সেকেন্ড
			return Math.min(retries * 100, 5000);
		},
	},
});

// এই listener না থাকলে Redis কানেকশন ড্রপ হলে (ECONNRESET ইত্যাদি)
// পুরো Node process crash করে যায়। তাই error টা শুধু log করে handle করা হচ্ছে।
redisclient.on("error", (err) => {
	console.error("Redis Client Error:", err);
});

redisclient.on("reconnecting", () => {
	console.log("Redis reconnecting...");
});

redisclient.on("connect", () => {
	console.log("Redis connected");
});