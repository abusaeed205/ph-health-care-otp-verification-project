import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";




const registerPatient = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body;
	await AuthService.registerPatient(payload);
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification OTP Sent",
		data: null
	});
	
});

const verifyPatientEmail= catchAsync(async (req: Request, res: Response) => {

const result=await AuthService.verifyPatientEmail(req.body);

	const { accessToken, refreshToken, user, patient } = result;

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification OTP Sent",
		data:{
			accessToken,
			refreshToken,
			user,
			patient
		}
	});
});

// const loginUser = catchAsync(async (req: Request, res: Response) => {
// 	const payload = req.body;
// 	const result = await AuthService.loginUser(payload);
// 	const { accessToken, refreshToken } = result;

// 	res.cookie("accessToken", accessToken, {
// 		httpOnly: true,
// 		secure: false,
// 		sameSite: "none",
// 		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
// 	});
// 	res.cookie("refreshToken", refreshToken, {
// 		httpOnly: true,
// 		secure: false,
// 		sameSite: "none",
// 		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
// 	});

// 	sendResponse(res, {
// 		statusCode: httpStatus.OK,
// 		success: true,
// 		message: "User logged in successfully",
// 		data: {
// 			accessToken,
// 			refreshToken,
// 		},
// 	});
// });

// User Login Controller
// Client থেকে login request আসলে এই function কাজ করবে।

const loginUser = catchAsync(async (req: Request, res: Response) => {

  // Client/frontend থেকে পাঠানো login data নিচ্ছি।
  //
  // যেমন:
  // {
  //   "email": "saeed@gmail.com",
  //   "password": "123456"
  // }
  //
  // req.body-এর ভিতরে এই data থাকবে।
  const payload = req.body;


  // এখন Controller থেকে AuthService-এর loginUser()
  // function call করছি।
  //
  // মূল login-এর কাজ Service layer-এ হবে।
  //
  // যেমন:
  // 1. Email দিয়ে user খোঁজা
  // 2. Password মিলানো
  // 3. User blocked/deleted কিনা check করা
  // 4. Access Token তৈরি করা
  // 5. Refresh Token তৈরি করা
  const result = await AuthService.loginUser(payload);


  // AuthService থেকে যে result এসেছে
  // তার মধ্যে থেকে accessToken এবং refreshToken বের করছি।
  //
  // result সাধারণত এমন হবে:
  //
  // {
  //   accessToken: "eyJhbGciOi...",
  //   refreshToken: "eyJhbGciOi..."
  // }
  const { accessToken, refreshToken } = result;


  // --------------------------------------------------
  // Access Token Cookie হিসেবে Browser-এ পাঠানো হচ্ছে
  // --------------------------------------------------

  res.cookie("accessToken", accessToken, {

    // JavaScript-এর document.cookie দিয়ে
    // এই cookie access করা যাবে না।
    //
    // অর্থাৎ XSS attack-এর ক্ষেত্রে JavaScript
    // সরাসরি token পড়তে পারবে না।
    httpOnly: true,


    // HTTPS ব্যবহার করলে secure: true করা উচিত।
    //
    // Development-এর localhost environment-এ
    // অনেক সময় false রাখা হয়।
    secure: false,


    // Cross-site request-এর ক্ষেত্রে cookie পাঠানোর policy।
    sameSite: "none",


    // Cookie কতক্ষণ Browser-এ থাকবে।
    //
    // 1000 milliseconds = 1 second
    // 60 seconds = 1 minute
    // 60 minutes = 1 hour
    // 24 hours = 1 day
    //
    // তাই এখানে Cookie-এর lifetime = 24 ঘণ্টা।
    maxAge: 1000 * 60 * 60 * 24,
  });


  // --------------------------------------------------
  // Refresh Token Cookie হিসেবে Browser-এ পাঠানো হচ্ছে
  // --------------------------------------------------

  res.cookie("refreshToken", refreshToken, {

    // JavaScript থেকে cookie access করা যাবে না।
    httpOnly: true,


    // Production-এ HTTPS থাকলে true হওয়া উচিত।
    secure: false,


    // Cross-site request-এর জন্য cookie policy।
    sameSite: "none",


    // Refresh Token-এর cookie 7 দিন থাকবে।
    //
    // 1000 ms
    // × 60 = 1 minute
    // × 60 = 1 hour
    // × 24 = 1 day
    // × 7 = 7 days
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });


  // --------------------------------------------------
  // সবশেষে Client/Frontend-কে response পাঠানো হচ্ছে
  // --------------------------------------------------

  sendResponse(res, {

    // HTTP status code 200
    //
    // অর্থাৎ request সফল হয়েছে।
    statusCode: httpStatus.OK,


    // Request সফল হয়েছে।
    success: true,


    // Frontend/User-এর জন্য success message।
    message: "User logged in successfully",


    // Response-এর মূল data।
    data: {

      // Access Token response body-তেও পাঠানো হচ্ছে।
      accessToken,

      // Refresh Token response body-তেও পাঠানো হচ্ছে।
      refreshToken,
    },
  });

});

const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new Error("User information is missing in the request");
	}

	const result = await AuthService.getMe(user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	if (!req.cookies.refreshToken) {
		throw new Error("Refresh token is missing");
	}
	const result = await AuthService.refreshToken(req.cookies.refreshToken);
	const { accessToken, refreshToken: newRefreshToken } = result;

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", newRefreshToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});


const googleLoginController = catchAsync(async (req: Request, res: Response) => {
	
	const payload=req.body

	const result=await AuthService.googleLogin(payload)
	const { accessToken, refreshToken } = result;

		res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: false,
		sameSite: "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});



	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});


const forgetPassword = catchAsync(async (req: Request, res: Response) => {
	
	const payload=req.body
   // এটা service থেকে আসছে 
  await AuthService.forgetPassword(payload)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `OTP Send to Email ${payload.email}`,
		data: null
	});
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
	
	const payload=req.body
	// এটা service থেকে আসছে 
  await AuthService.resetPassword(payload)

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password Change successfully",
		data: null
	});
});


export const AuthController = {
	registerPatient,
	verifyPatientEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLoginController,
   forgetPassword,
   resetPassword
};
