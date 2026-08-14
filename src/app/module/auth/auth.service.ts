
import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { AuthProvider, Role, UserStatus } from "../../../generated/prisma/enums";
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
} from "./auth.interface";
import { googleclient } from "../../lib/googleAuth_ID";
import crypto from "crypto"
import { redisclient } from "../../lib/redis";
import { transporter } from "../../lib/nodemailler";
import ejs from "ejs"
import path from "path";


const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password, patient:patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, 8);

  
  // data গুলো payload থেকে পাই 
  const redisUserDataPayload={
    name,
    email,
    password:hashedPassword,
    patient:patientData
  }

  // redis এ আমরা client ডাটা স্টোর করবো OTP verify করতে 




	const createdUser = await prisma.user.create({
	data: {
		name,
		email,
		password: hashedPassword,
		role: Role.PATIENT,
		status: UserStatus.ACTIVE,
		emailVerified: false,
    // patientData থাকলে Patient তৈরি করো, না থাকলে এই অংশটা বাদ দাও।
		...(patientData && {
			patient: {
				create: {
					name,
					email,
					contactNumber: patientData.contactNumber || null,
				},
			},
		}),
	},
	omit: { password: true },
	include: { patient: true },
});

	const { patient, ...user } = createdUser;
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
		throw new Error("User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if(user.password===null && user.googleId !==null){
		throw new Error("User already registered with Google, please login with Google");
	}


	const isPasswordMatched = await bcrypt.compare(password, user.password as string);

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
// const googleLogin = async(payload:IGoogleLoginPayload ) => {
// 	let googleIdTokenPayload : TokenPayload | null | undefined= null
	
// 	try{
// 		const ticket=await googleclient.verifyIdToken({
// 			idToken:payload.idToken,
// 			audience:config.google_client_id
// 		})
// 		googleIdTokenPayload=ticket.getPayload()
// 	}catch(error){
// 		console.log("Google Id Token verification error:",error)
// 		throw new Error("Invalid Google ID Token")
// 	}

// 	if(!googleIdTokenPayload){
// 		throw new Error("Invalid Google ID Token payload")
// 	}

// 	if(!googleIdTokenPayload.email){
// 		throw new Error("Email not found in Google ID Token payload")
// 	}
// 	if(!googleIdTokenPayload.name){
// 		throw new Error("Name not found in Google ID Token payload")
// 	}
	

// 	const ifPatientExistsWithGoogleAuth=await prisma.user.findUnique({
// 		where:{
// 			email:googleIdTokenPayload.email,
// 			role:Role.PATIENT,
// 			googleId:googleIdTokenPayload.sub
// 		}
// 	})

// 	let user=ifPatientExistsWithGoogleAuth
//     // create a new user if not exists
// 	if(!ifPatientExistsWithGoogleAuth){

// 		const ifpatientExistWithCredential=await prisma.user.findUnique({
// 			where:{
// 				email:googleIdTokenPayload.email,
// 				role:Role.PATIENT,
// 				authProvider:AuthProvider.CREDENTIALS
// 			}
// 		})
// 		if(ifpatientExistWithCredential){
// 			if(!ifpatientExistWithCredential.emailVerified){
// 				throw new Error("Email is not verified, please verify your email first")
// 			}


// 			if(ifpatientExistWithCredential.status===UserStatus.BLOCKED){
// 				throw new Error("User is blocked")
// 			}
// 			if(ifpatientExistWithCredential.isDeleted || ifpatientExistWithCredential.status===UserStatus.DELETED){
// 				throw new Error("User is deleted")
// 			}
// 			user=await prisma.user.update({
// 				where:{
// 					id:ifpatientExistWithCredential.id
// 				},
// 				data:{
// 					googleId:googleIdTokenPayload.sub,
// 					authProvider:AuthProvider.GOOGLE,
// 					emailVerified:true
// 				}
// 			})		
			
// 		}else{
// 		// Google Registered user exists
// 		user=await prisma.user.create({
// 			data:{
// 				email:googleIdTokenPayload.email,
// 				name:googleIdTokenPayload.name,
// 				role:Role.PATIENT,
// 				googleId:googleIdTokenPayload.sub,
// 				authProvider:AuthProvider.GOOGLE,
// 				emailVerified:true,
// 				patient:{
// 					create:{
// 						name:googleIdTokenPayload.name,
// 						email:googleIdTokenPayload.email
// 					}
// 				}
// 			}

// 		})
// 	}

		
// 	}

// 	if(!user) {
// 		throw new Error("User not found or created")
// 	}

// 	if(user.status===UserStatus.BLOCKED){
// 		throw new Error("User is blocked")
// 	}
// 	if(user.isDeleted || user.status===UserStatus.DELETED){
// 		throw new Error("User is deleted")
// 	}


// 	const jwtPayload = {
// 		userId: user.id,
// 		name: user.name,
// 		email: user.email,
// 		role: user.role,
// 	};

// 	const accessToken = jwtUtils.createToken(
// 		jwtPayload,
// 		config.jwt_access_secret,
// 		config.jwt_access_expires_in as SignOptions,
// 	);

// 	const refreshToken = jwtUtils.createToken(
// 		jwtPayload,
// 		config.jwt_refresh_secret,
// 		config.jwt_refresh_expires_in as SignOptions,
// 	);

// 	return {
// 		accessToken,
// 		refreshToken,
// 	};

	
// }
// Google Login function
// payload এর মধ্যে Google থেকে পাওয়া idToken থাকবে
const googleLogin = async (payload: IGoogleLoginPayload) => {

  // Google ID Token verify করার পরে যে information পাওয়া যাবে,
  // সেটা এখানে রাখা হবে || শুরুতে null রাখা হয়েছে।
  let googleIdTokenPayload: TokenPayload | null | undefined = null;

  try {

    // client থেকে আসা idToken যাচাই করছি।
	// googleclient এটা Lib Folder থেকে আসছে 
    const ticket = await googleclient.verifyIdToken({
      // User-এর পাঠানো Google ID 
      idToken: payload.idToken,

      // এটা দিয়ে নিশ্চিত করা হয় token-টি আমাদের application-এর জন্যই তৈরি হয়েছে।
      audience: config.google_client_id,
    });

    // Token verify সফল হলে Google token-এর ভিতরের তথ্য বের করছি।
    // এখানে সাধারণত পাওয়া যায়:
    // sub   = Google User ID
    // email = User-এর email
    // name  = User-এর নাম
    // picture = Profile picture ইত্যাদি
    googleIdTokenPayload = ticket.getPayload();

  } catch (error) {

    // Token verify করতে কোনো সমস্যা হলে এখানে আসবে।
    console.log("Google Id Token verification error:", error);

    // Client-কে generic error দিচ্ছি।
    throw new Error("Invalid Google ID Token");
  }


  // Google থেকে কোনো payload পাওয়া না গেলে
  // Login বন্ধ করে দিচ্ছি।
  if (!googleIdTokenPayload) {
    throw new Error("Invalid Google ID Token payload");
  }


  // Google token-এর মধ্যে email না থাকলে
  // User identify করা সম্ভব হবে না।
  if (!googleIdTokenPayload.email) {
    throw new Error("Email not found in Google ID Token payload");
  }


  // Google token-এর মধ্যে name না থাকলে
  // নতুন User তৈরি করার সময় name পাওয়া যাবে না।
  if (!googleIdTokenPayload.name) {
    throw new Error("Name not found in Google ID Token payload");
  }


  // এখন database-এ খুঁজছি:
  // "এই Google account দিয়ে আগে থেকেই Patient হিসেবে
  // account তৈরি করা আছে কি?"
  const ifPatientExistsWithGoogleAuth = await prisma.user.findUnique({
    where: {
      email: googleIdTokenPayload.email,
      role: Role.PATIENT,
      googleId: googleIdTokenPayload.sub,
    },
  });


  // আগে থেকেই Google account পাওয়া গেলে
  // user variable-এ সেই user থাকবে।
  let user = ifPatientExistsWithGoogleAuth;


  // যদি Google authentication দিয়ে User আগে থেকে না থাকে
  // তাহলে এই block-এর ভিতরে যাব।
  if (!ifPatientExistsWithGoogleAuth) {

  // সাধারণ ভাবে রেজিস্ট্রেশন করার পর আবার Google দিয়ে Login করতেছে কি না তা চেক করা হচ্ছে।
 
    const ifPatientExistWithCredential = await prisma.user.findUnique({
      where: {
        email: googleIdTokenPayload.email,
        role: Role.PATIENT,
        authProvider: AuthProvider.CREDENTIALS,
      },
    });


    // যদি একই email-এর Credentials account পাওয়া যায়
    if (ifPatientExistWithCredential) {
      // আগে সেই account-এর email verify করা হয়েছে কিনা দেখছি。
      if (!ifPatientExistWithCredential.emailVerified) {
        throw new Error(
          "Email is not verified, please verify your email first"
        );
      }


      // User BLOCKED কিনা check করছি।
      if (ifPatientExistWithCredential.status === UserStatus.BLOCKED) {

        // Blocked হলে Login করতে দিচ্ছি না।
        throw new Error("User is blocked");
      }


      // User delete করা হয়েছে কিনা check করছি।
      //
      // দুইভাবে delete হতে পারে:
      // 1. isDeleted = true
      // 2. status = DELETED
      if (
        ifPatientExistWithCredential.isDeleted ||
        ifPatientExistWithCredential.status === UserStatus.DELETED
      ) {
        // Deleted user Login করতে পারবে না।
        throw new Error("User is deleted");
      }


      // Credentials account-কে এখন Google account-এর সাথে
      // connect/link করে দিচ্ছি।
      user = await prisma.user.update({

        // কোন User update করতে হবে
        // তার id দিয়ে খুঁজছি।
        where: {
          id: ifPatientExistWithCredential.id,
        },

        // User-এর data update করছি।
        data: {

          // Google-এর unique user ID database-এ save করছি।
          googleId: googleIdTokenPayload.sub,

          // Auth provider এখন GOOGLE করে দিচ্ছি।
          // অর্থাৎ পরবর্তীতে এই account Google authentication
          // দিয়ে Login করতে পারবে।
          authProvider: AuthProvider.GOOGLE,

          // Google দিয়ে successfully authenticate হওয়ায়
          // emailVerified true করছি।
          emailVerified: true,
        },
      });


    } else {

      // এখানে আসার অর্থ:
      //
      // 1. এই Google account আগে থেকে নেই
      // 2. এই email দিয়ে Credentials account-ও নেই
      //
      // তাই নতুন User তৈরি করতে হবে।

      user = await prisma.user.create({

        data: {

          // Google account-এর email database-এ save করছি।
          email: googleIdTokenPayload.email,

          // Google account থেকে পাওয়া name save করছি।
          name: googleIdTokenPayload.name,

          // User-এর role PATIENT হিসেবে সেট করছি।
          role: Role.PATIENT,

          // Google-এর unique ID save করছি।
          googleId: googleIdTokenPayload.sub,

          // Authentication provider GOOGLE হবে।
          authProvider: AuthProvider.GOOGLE,

          // Google account verify করা হয়েছে,
          // তাই emailVerified true।
          emailVerified: true,

          // User-এর সাথে Patient record-ও তৈরি করছি।
          patient: {

            create: {

              // Patient table-এ name save করছি।
              name: googleIdTokenPayload.name,

              // Patient table-এ email save করছি।
              email: googleIdTokenPayload.email,
            },
          },
        },
      });
    }
  }


  // কোনো কারণে user পাওয়া না গেলে
  // এবং create/update-ও না হলে error দিবে।
  if (!user) {
    throw new Error("User not found or created");
  }


  // User BLOCKED কিনা আবার check করছি।
  //
  // এটা গুরুত্বপূর্ণ কারণ User Google account দিয়ে আগে থেকেই
  // exist করতে পারে।
  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }


  // User deleted কিনা আবার check করছি।
  if (
    user.isDeleted ||
    user.status === UserStatus.DELETED
  ) {
    throw new Error("User is deleted");
  }


  // JWT Token-এর ভিতরে যেসব information রাখতে চাই
  // সেগুলো এখানে তৈরি করছি।
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };


  // Access Token তৈরি করছি।
  const accessToken = jwtUtils.createToken(
    jwtPayload,

    // Access token-এর secret key
    config.jwt_access_secret,

    // Access token কতক্ষণ valid থাকবে
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,

    // Refresh token-এর secret key
    config.jwt_refresh_secret,

    // Refresh token কতক্ষণ valid থাকবে
    config.jwt_refresh_expires_in as SignOptions,
  );


  
  return {
    accessToken,
    refreshToken,
  };
};


const forgetPassword=async(payload:IForgotPasswordPayload)=>{
  const {email}=payload

  const isUserExist=await prisma.user.findUnique({
    where:{
      email
    }
  })

  if(!isUserExist){
    throw new Error("User Dose Not Exist")
  }

  if(isUserExist?.status==="BLOCKED"){
    throw new Error("user is Blocked")
  }

  if(!isUserExist.emailVerified){
    throw new Error("User Not Verified")
  }

  if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
    throw new Error("User is Deleted")
  }

  if(isUserExist.googleId && isUserExist.authProvider==="GOOGLE"){
    throw new Error("User Has Account with Google")
  }

  // crypto দিয়ে Random OTP বানিয়ে redis ডাটাবেইজে জমা করা হচ্ছে
  const otp=crypto.randomInt(100000,1000000).toString()
  const key=`forgot-password-otp:${isUserExist.email}`
  
  
 const expirationMinutes=5*60 // টাইমটা বলেদিতেছে কতো মিনিট থাকবে OTP
  
  // redisclient lib foulder থেকে আসতেছে এবং OTP Set করছি 
  await redisclient.set(key,otp,{
    expiration:{
      type:"EX",
      value:expirationMinutes
    }
  }) 


  // যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম 
  const tempatePath=path.join(process.cwd(),"src/app/templates/forgot-password.ejs")
  // email massage temp formet
  const html= await ejs.renderFile(tempatePath,{
    name:isUserExist.name,
    OTP:otp ,// OTP এখানে যেভাবে লিখবো templates/forgot-password.ejs এ সেইম থাকবে
    expirationMinutes:expirationMinutes/60
  })

  // Password Change করলে Gmail এ email যাবে 
  await transporter.sendMail({
    // env config file থেকে আসতেছে 
    from:config.email_sender,
    to:isUserExist.email,
    subject:"Forgot Password",
    html
  })


}

const resetPassword=async(payload:IResetPasswordPayload)=>{
 const {email,otp,newPassword}=payload

  const isUserExist=await prisma.user.findUnique({
    where:{
      email
    }
  })

  if(!isUserExist){
    throw new Error("User Dose Not Exist")
  }

  if(isUserExist?.status==="BLOCKED"){
    throw new Error("user is Blocked")
  }

  if(!isUserExist.emailVerified){
    throw new Error("User Not Verified")
  }

  if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
    throw new Error("User is Deleted")
  }

  if(isUserExist.googleId && isUserExist.authProvider==="GOOGLE"){
    throw new Error("User Has Account with Google")
  }

  const key=`forgot-password-otp:${isUserExist.email}`
    // redisclient lib foulder থেকে আসতেছে
  const redisOtp=await redisclient.get(key)

  if(!redisOtp){
    throw new Error("Invalid OTP")
  }


  if(redisOtp !== otp){
    throw new Error("OTP Does Not Match")
  }


  const hashedNewPassword=await bcrypt.hash(newPassword,Number(config.bcrypt_salt_rounds))
  await prisma.user.update({
    where:{
      email:isUserExist.email
    },
    data:{
      password:hashedNewPassword
    }
  })

    // redisclient lib foulder থেকে আসতেছে
  await redisclient.del([key])


   // যে ফাইলটাতে ejs কোড রাখা আছে সেটা এটার সাথে Join দিলাম 
  const tempatePath=path.join(process.cwd(),"src/app/templates/reset-Password.ejs")
  // email massage temp formet
  const html= await ejs.renderFile(tempatePath,{
    name:isUserExist.name,
  })

    // Password Change করলে Gmail এ email যাবে 
  await transporter.sendMail({
    // env config file থেকে আসতেছে 
    from:config.email_sender,
    to:isUserExist.email,
    subject:"Password Change",
    html
  })

}






export const AuthService = {
	registerPatient,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
  forgetPassword,
  resetPassword
};
