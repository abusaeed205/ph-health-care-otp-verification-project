import type { Role } from "../../../generated/prisma/browser";

export interface ILoginUserPayload {
	email: string;
	password: string;
}

export interface IRegisterPatientPayload {
	name: string;
	email: string;
	password: string;
	patient:{
		contactNumber?: string;
	}
}



export interface IVerifyEmailPayload {
	email: string;
	otp:string
	
}






export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}

export interface IGoogleLoginPayload {
	idToken: string
}

// Service এ এগুলো ব্যবহার করা হয়েছে 
export interface IForgotPasswordPayload{
	email:string
}
// Service এ এগুলো ব্যবহার করা হয়েছে 
export interface IResetPasswordPayload{
	email:string
	newPassword:string
	otp:string
}