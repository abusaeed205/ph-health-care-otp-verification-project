
// biome-ignore assist/source/organizeImports: <explanation>
import type { NextFunction, Request, Response } from "express"; // Express এর Type গুলো import করা হচ্ছে (middleware লেখার জন্য দরকার)
import type { JwtPayload } from "jsonwebtoken"; // JWT টোকেন ডিকোড করলে যে ধরনের ডেটা পাওয়া যায় তার Type
import config from "../config";
import { prisma } from "../lib/prisma"; // Prisma ক্লায়েন্ট, ডাটাবেজ কুয়েরি করার জন্য
import { catchAsync } from "../utils/catchAsync"; // async ফাংশনের try/catch হ্যান্ডেল করার হেল্পার (error next এ পাঠায়)
import { jwtUtils } from "../utils/jwt"; // JWT verify/sign করার কাস্টম ইউটিলিটি ফাংশন
import type { Role } from "../../generated/prisma/enums"; // Prisma থেকে জেনারেট হওয়া Role enum (ADMIN, USER, AUTHOR ইত্যাদি)

// Express এর Request অবজেক্টে "user" নামে একটা কাস্টম প্রপার্টি যোগ করা হচ্ছে (Type augmentation)
// যাতে পরবর্তী middleware/controller গুলোতে req.user ব্যবহার করা যায় TypeScript error ছাড়া
declare global {
	namespace Express {
		interface Request {
			user?: {
				email: string;
				name: string;
				userId: string;
				role: Role;
			};
		}
	}
}

// উদাহরণ: auth(Role.ADMIN, Role.USER, Role.Author) => requiredRoles = [ADMIN, USER, AUTHOR]
// auth() => requiredRoles = [] (খালি array, মানে যেকোনো লগইন করা ইউজার এক্সেস পাবে)
export const auth = (...requiredRoles: Role[]) => {
	// এটা একটা Higher-Order Function — বাইরে থেকে requiredRoles নেয়, ভিতরে আসল middleware রিটার্ন করে
	return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
		// টোকেন খোঁজা হচ্ছে তিনটা জায়গায় (priority অনুযায়ী):
		// ১. cookie তে accessToken থাকলে সেটা নেওয়া হবে
		// ২. না থাকলে Authorization header এ "Bearer " দিয়ে শুরু হলে সেখান থেকে token আলাদা করা হবে
		// ৩. তাও না থাকলে পুরো Authorization header টাকেই token হিসেবে ধরা হবে
		const token = req.cookies.accessToken
			? req.cookies.accessToken
			: req.headers.authorization?.startsWith("Bearer ")
				? req.headers.authorization?.split(" ")[1]
				: req.headers.authorization;

		// কোনো টোকেনই না পাওয়া গেলে এরর থ্রো করা হচ্ছে (catchAsync এটা catch করে next(err) কল করবে)
		if (!token) {
			throw new Error(
				"You are not logged in. Please log in to access this resource.",
			);
		}

		// টোকেনটা verify করা হচ্ছে secret key দিয়ে — এটা valid কিনা, expire হয়ে গেছে কিনা চেক হয়
		const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

		// verify ব্যর্থ হলে (invalid/expired token) এরর থ্রো করা হচ্ছে
		if (!verifiedToken.success) {
			throw new Error(verifiedToken.error);
		}

		// verify সফল হলে টোকেনের ভেতর থেকে ডেটা (payload) বের করা হচ্ছে
		const { email, name, userId, role } = verifiedToken.data as JwtPayload;

		// যদি requiredRoles দেওয়া থাকে (যেমন শুধু ADMIN এক্সেস করতে পারবে এমন রুট)
		// এবং ইউজারের role সেই লিস্টে না থাকে, তাহলে Forbidden এরর থ্রো হবে
		if (requiredRoles.length && !requiredRoles.includes(role)) {
			throw new Error(
				"Forbidden. You don't have permission to access this resource.",
			);
		}

		// টোকেনের তথ্য দিয়ে ডাটাবেজে গিয়ে চেক করা হচ্ছে ইউজারটা আসলেই আছে কিনা এবং তথ্য মিলছে কিনা
		// (নিরাপত্তার জন্য — টোকেন ভ্যালিড হলেও ইউজার ডিলিট/পরিবর্তন হতে পারে)
		const user = await prisma.user.findUnique({
			where: {
				id: userId,
				email,
				name,
				role,
			},
		});

		// ডাটাবেজে ইউজার না পাওয়া গেলে এরর থ্রো করা হচ্ছে
		if (!user) {
			throw new Error("User not found. Please log in again.");
		}

		// ইউজারের status যদি BLOCKED হয়, তাহলে এক্সেস দেওয়া হবে না
		if (user.status === "BLOCKED") {
			throw new Error("Your account has been blocked. Please contact support.");
		}

		// সব চেক পাশ করলে req.user এ ইউজারের তথ্য বসিয়ে দেওয়া হচ্ছে
		// যাতে এর পরের middleware/controller এই তথ্য সরাসরি ব্যবহার করতে পারে
		req.user = {
			email,
			name,
			userId,
			role,
		};

		// সব ঠিক থাকলে পরবর্তী middleware/controller এ কন্ট্রোল পাঠিয়ে দেওয়া হচ্ছে
		next();
	});
};

// import { NextFunction, Request, Response } from "express";
// import { JwtPayload } from "jsonwebtoken";

// import config from "../config";
// import { prisma } from "../lib/prisma";
// import { catchAsync } from "../utils/catchAsync";
// import { jwtUtils } from "../utils/jwt";
// import { Role } from "../../generated/prisma/enums";

// declare global {
//     namespace Express {
//         interface Request {
//             user?: {
//                 email: string;
//                 name: string;
//                 userId: string;
//                 role: Role;
//             }
//         }
//     }
// }

// // auth(Role.ADMIN, Role.USER, Role.Author)
// // auth() => ...requiredRoles => [Role.ADMIN, Role.USER, Role.AUTHOR]
// export const auth = (...requiredRoles: Role[]) => {
//     return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
//         const token = req.cookies.accessToken ?
//             req.cookies.accessToken
//             :
//             req.headers.authorization?.startsWith("Bearer ") ?
//                 req.headers.authorization?.split(" ")[1]
//                 : req.headers.authorization;

//         if (!token) {
//             throw new Error("You are not logged in. Please log in to access this resource.");
//         }

//         const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

//         if (!verifiedToken.success) {
//             throw new Error(verifiedToken.error);
//         }

//         const { email, name, userId, role } = verifiedToken.data as JwtPayload;

//         if (requiredRoles.length && !requiredRoles.includes(role)) {
//             throw new Error("Forbidden. You don't have permission to access this resource.");
//         }

//         const user = await prisma.user.findUnique({
//             where: {
//                 id: userId,
//                 email,
//                 name,
//                 role
//             }
//         });

//         if (!user) {
//             throw new Error("User not found. Please log in again.");
//         }

//         if (user.status === "BLOCKED") {
//             throw new Error("Your account has been blocked. Please contact support.");
//         }

//         req.user = {
//             email,
//             name,
//             userId,
//             role
//         }

//         next();

//     }
//     )
// }
