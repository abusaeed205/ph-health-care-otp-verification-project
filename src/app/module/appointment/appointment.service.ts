
import {
	AppointmentStatus,
	PaymentStatus,
	Role,
	Schedulestatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { IBookAppointmentPayload, ICancelAppointmentPayload, IPayAppointmentPayload, IUpdateAppointmentStatusPayload } from "./appointments.interface";
import { AppError } from "../../utils/appError";
import httpStatus from "http-status"
import { addMinutes, isBefore, isSameDay, subHours } from "date-fns";
import { transporter } from "../../lib/nodemailler";
import PDFDocument from 'pdfkit';
import { IPostQuery } from "../../interface";
import { AppointmentWhereInput } from "../../../generated/prisma/models";

//----- 01-Appointment Book bKash Payment ---------
// payload:any,user:Request পরে যুক্ত হবে
const bookAppointment = async (payload:IBookAppointmentPayload, user: RequestUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {

		// before 

		const patient = await prisma.patient.findUnique({
			where: { userId: user.userId },
		});

		if (!patient) {
			throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
		}

		const schedule=await prisma.schedule.findUnique({
			where:{id:payload.scheduleId},
			include:{doctor:true}
		})

		if(!schedule || schedule.isDeleted){
			throw new AppError(httpStatus.NOT_FOUND,"schedule Not Found")
		} 

		if(schedule.status !== Schedulestatus.PUBLISHED){
			throw new AppError(httpStatus.BAD_REQUEST,"This Schedule is not published yet")
		}

		const nowDate=new Date()

		if(!isSameDay(nowDate,schedule.startDateTime)){
			throw new AppError(httpStatus.BAD_REQUEST,"This Schedule Is Not Available Today")
		}

		if(!isBefore(nowDate ,schedule.startDateTime)){
			throw new AppError(httpStatus.BAD_REQUEST,"This schedule Has Already Started")
		}

		const existingAppointment = await prisma.appointment.findFirst({
			where: {
				patientId: user.userId,
				scheduleId:schedule.id,
				// status:{not : AppointmentStatus.CANCELLED}
			}
		});

		if(existingAppointment?.status === AppointmentStatus.PENDING){
			throw new AppError(httpStatus.BAD_REQUEST,"You Already Have A Pending Appointment.please pay For That")
		}
		if(existingAppointment?.status === AppointmentStatus.CONFIRMED){
			throw new AppError(httpStatus.BAD_REQUEST,"You Already Have A Confirmed Appointment.")
		}

		if(existingAppointment?.status === AppointmentStatus.ONGOING){
			throw new AppError(httpStatus.BAD_REQUEST,"You Already Have A Ongoing Appointment.")
		}

		if(existingAppointment?.status === AppointmentStatus.COMPLETED){
			throw new AppError(httpStatus.BAD_REQUEST,"You Already Have A completed An Appointment on This Schedule.Please Try Again Another Day")
		}

		if(schedule.availableslots === 0){
			throw new AppError(httpStatus.BAD_REQUEST,"This schedule Is Fully Booked")
		}

		if(!schedule.doctor.consultationFee){
			throw new AppError(httpStatus.BAD_REQUEST,"Doctor Has Not Set A Consultation Fee Yet")
		}

		const amount =schedule.doctor.consultationFee.toString()



		//-------------------------business logic (sTART)----------------------
		//----------------------step 03 appointment create---------------------
		const appointment = await tx.appointment.create({
			data: {
				status: AppointmentStatus.PENDING,
				// পরে যুক্ত হবে Doctor ID parient-ID
				patientId:patient.id,
				doctorId:schedule.doctor.id,
				scheduleId:schedule.id
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
					amount: amount,
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
				amount:amount,
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
const payAppointment = async (payload:IPayAppointmentPayload, user: RequestUser) => {
	const appoindmentID = payload.appointmentId;

	const existingAppointment = await prisma.appointment.findUnique({
		where: {
			id: appoindmentID,
		},
		include:{
			schedule:{
				include:{
					doctor:true
				}
			}
		}
	});

	if (!existingAppointment) {
		throw new Error("Appoint id not existing");
	}

	if (existingAppointment.status !== "PENDING") {
		throw new Error("Appointment Is Not Pending");
	}

	if(!existingAppointment.schedule.doctor.consultationFee){
		throw new AppError(httpStatus.BAD_REQUEST,"Doctor Has Not Set A Consultation Fee yet")
	}

	const amount =existingAppointment.schedule.doctor.consultationFee.toString()

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
				amount: amount,
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
			const appointment=await prisma.appointment.findUnique({
				where:{
					id:executedPaymentResult.merchantInvoiceNumber
				},
				include:{
					schedule:true,
					patient:true,
					doctor:true
				}
			})

			if(!appointment){
				throw new AppError(httpStatus.NOT_FOUND,"Appointment Not Found!")
			}

			
			// total slot =3,available slot=3
			//(total - available) +1
			const alreadyBookedSlots=appointment.schedule.totalSlots -appointment.schedule.availableslots

			const serialNumber=alreadyBookedSlots+1

			//25Augest=>3:00 PM - 4:00pm
			//1st person joining time=>startDatime= 2026-08-25T15:00:00.436Z=>3:00 pm
			//serial number(1)-1*20 => 0 minutes

			//2nd person joining time=>startDatime= 2026-08-25T15:20:00.436Z=>3:00 pm
			// serial number(2)-1*20=>20 minutes
			
			//3rd person joining time=>startDatime= 2026-08-25T15:40:00.436Z=>3:00 pm
			//serial number(3) - 1*24=>40 minutes
			// business logic Database Update

			

			const joiningTime =addMinutes(
				appointment.schedule.startDateTime,
				(serialNumber -1)*20
			)

			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
					joiningTime,
					serialNumber
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
				},
			});

			const newAvailableSlots=appointment.schedule.availableslots -1

			await prisma.schedule.update({
				where:{
					id:appointment.schedule.id
				},
				data:{
					availableslots:newAvailableSlots
				}
			})

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
        //    create the PDF  
		const pdfDocument=new PDFDocument({margin:50})

		const pdfChunks:Buffer[]=[]
		pdfDocument.on("data",(chunk:Buffer)=>{
			pdfChunks.push(chunk)
		})

		const pdfReadyPromise= new Promise<Buffer>((resolve)=>{
			pdfDocument.on("end",()=>{
				resolve(Buffer.concat(pdfChunks))
			})
		})

		pdfDocument.fontSize(20).text("PH Healthcare System",{align:"center"})
		pdfDocument.fontSize(14).text("Appointment Invoice",{align:"center"})
		pdfDocument.moveDown()

		pdfDocument.fontSize(12).text(`Patient Name: ${appointment.patient?.name}`)
		pdfDocument.text(`Patient Email: ${appointment.patient?.email}`)
		pdfDocument.moveDown(2)

		pdfDocument.text(`Doctor Name: ${appointment.doctor?.name}`)
		pdfDocument.text(`Specialization: ${appointment.doctor?.specialization}`)
		pdfDocument.moveDown()

		pdfDocument.text(
			`Appointment Date:${appointment.schedule.startDateTime.toDateString()}`
		)

		pdfDocument.text(`Your Joining Time:${joiningTime.toString()}`)
		pdfDocument.text(`Your Serial Number:${serialNumber}`)
		pdfDocument.text(`Meeting Link:${appointment.schedule.meetingLink}`)
		pdfDocument.moveDown()

		pdfDocument.text(`Amount Paid:${executedPaymentResult.amount}BDT`)
		pdfDocument.text(`Pyment Method:Bkash`)
		pdfDocument.text(`Transaction Id:${executedPaymentResult.trxID}`)
		pdfDocument.text(`Paid At:${executedPaymentResult.paymentExecuteTime}`)
		
		pdfDocument.end()
		
		// এই pdfBuffer টা আমরা Email এ পাঠাবে 
		const pdfBuffer=await pdfReadyPromise

			await transporter.sendMail({
				from:config.email_sender,
				to:appointment.patient.email,
				subject:"Your Appointment Invoice-Ph Healthcare System",
				text:"Thank you for booking an appointment.Please find your invoice attached.",
				attachments:[
					{filename:"Invoice.pdf",
					content:pdfBuffer
					}
				]
			})

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
const cancelAppointment = async (payload:ICancelAppointmentPayload,user:RequestUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const appointmentId = payload.appointmentId;

		const existingAppointment = await tx.appointment.findUnique({
			where: {
				id: appointmentId,
				patient:{
					email:user.email
				}
			},
			// true করার জন্য Paymentএর ডাটা Appointment এ পাবো
			include: {
				payment: true,
				schedule:true
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
				status: AppointmentStatus.CANCELLED,
			},
		});

		await prisma.schedule.update({
			where:{
				id:existingAppointment.schedule.id
			},
			data:{
				availableslots:{increment:1}
			}
		})

		// refund payment
		const now=new Date()
		const startDateTime=existingAppointment.schedule.startDateTime //25 Augest:3:00 Pm
		//after 2:00 pm =>no refund
		//must cancel before 2:00pm
		const refundCutOffTime=subHours(startDateTime,1)
		//now=>refuncCutoff Time =>No refund
		//now <
		const isEligibleForRefund= isBefore(now,refundCutOffTime)

		if(isEligibleForRefund){
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

		await tx.payment.update({
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

		}
		const newPaymentInfo=await prisma.payment.findUnique({
			where:{
				appointmentID:existingAppointment.id
			}
		})
		
		return {
			appointment: updatedAppointment,
			payment: newPaymentInfo,
		};
	});

	return transactionResult;
};

// Doctor noly scheule CONFIRMED=>ONGOING=>COMPLETED=> Update 
const updateAppointmentStatus =async(
	appointmentId:string,
	payload:IUpdateAppointmentStatusPayload,
	user:RequestUser
)=>{

	const doctor=await prisma.doctor.findUnique({
		where:{userId:user.userId}
	})

	if(!doctor){
		throw new AppError(httpStatus.NOT_FOUND,"Doctor Profiole Not Found")
	}

	const appointment=await prisma.appointment.findUnique({
		where:{id:appointmentId,doctorId:doctor.id}
	})

	if(!appointment){
		throw new AppError(httpStatus.NOT_FOUND,"Appointment NOt Found")
	}
	
	if(appointment.status ===AppointmentStatus.COMPLETED){
		throw new AppError(httpStatus.FORBIDDEN,"Appointment is already Completed")
	}

	if(appointment.status ===AppointmentStatus.CANCELLED){
		throw new AppError(httpStatus.FORBIDDEN,"Appointment is already Cancelled")
	}

	if(appointment.status ===AppointmentStatus.PENDING){
		throw new AppError(httpStatus.FORBIDDEN,"Appointment is Pending.You can Change the status after appointment is confirmed")
	}

	if(appointment.status === AppointmentStatus.CONFIRMED && payload.status !=="ONGOING" || payload.status !== "COMPLETED"){
		throw new AppError(httpStatus.BAD_REQUEST,"Confirmed Appointment Must Be Ongoing At First")
	}
	
	await prisma.appointment.update({
		where:{
			id:appointment.id
		},
		data:{
		    status:AppointmentStatus.ONGOING
		}
	})

	if(appointment.status === AppointmentStatus.ONGOING){
		if(payload.status !== "COMPLETED"){
			throw new AppError(httpStatus.BAD_REQUEST,"Ongoing Appointment Must Be Completed")
		}

		await prisma.appointment.update({
			where:{
				id:appointment.id
			},
			data:{
				status:AppointmentStatus.COMPLETED
			}
		})
	}

	const updateAppointment=await prisma.appointment.findUnique({
		where:{
			id:appointment.id
		}
	})

	return updateAppointment
}

// patient appointments 
const getMyAppoinents=async(query:IPostQuery,user:RequestUser)=>{
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const patient = await prisma.patient.findUnique({
		where: { userId: user.userId },
	});

	if (!patient) {
		throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			patientId : patient.id
		}
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

		const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder},
		include: {
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};

}
// patient appointments 
const getDoctorAppoinents=async(query:IPostQuery,user:RequestUser)=>{
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const doctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			doctorId : doctor.id
		}
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder},
		include: {
			patient: {
				select: { id: true, name: true, email: true, contactNumber: true },
			},
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
}

// addmin ,super-admin
const getAllAppoinents=async(query:IPostQuery)=>{
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const andConditions: AppointmentWhereInput[] = [];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	if (query.doctorId) {
		andConditions.push({ doctorId: query.doctorId });
	}

	if (query.patientId) {
		andConditions.push({ patientId: query.patientId });
	}

	if(query.doctorEmail){
		andConditions.push({
			doctor : {
				email : query.doctorEmail
			}
		})
	}
	if(query.patientEmail){
		andConditions.push({
			patient : {
				email : query.patientEmail
			}
		})
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder },
		include: {
			patient: { select: { id: true, name: true, email: true } },
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};

}
//for all login user
const getSigleAppoinents=async(appointmentId:string,user:RequestUser)=>{
	const appointment = await prisma.appointment.findUnique({
		where: { id: appointmentId },
		include: {
			patient: { select: { id: true, name: true, email: true, userId: true } },
			doctor: {
				select: { id: true, name: true, specialization: true, userId: true },
			},
			schedule: true,
			payment: true,
		},
	});

	if (!appointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
	}

	if(user.role === Role.PATIENT){
		if(appointment.patient.userId !== user.userId){
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}
	if(user.role === Role.DOCTOR){
		if(appointment.doctor.userId !== user.userId){
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}

	return appointment
}


export const AppointmentServices = {
	bookAppointment,
	payAppointment,
	bookAppointmentCallback,
	cancelAppointment,
	updateAppointmentStatus,
	getMyAppoinents,
	getDoctorAppoinents,
	getAllAppoinents,
	getSigleAppoinents
};
