import { addDays, differenceInMinutes, isAfter, isSameDay, startOfDay } from "date-fns"
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/appError"
import { ICreateSchedulePayload, IUpdateSchedulePayload } from "./schedule.interface"
import httpStatus, { status } from "http-status"
import { IPostQuery } from "../../interface"
import { ScheduleWhereInput } from "../../../generated/prisma/models"
import { Schedulestatus } from "../../../generated/prisma/enums"



const createSchedule=async(payload:ICreateSchedulePayload,user:RequestUser)=>{
    const doctor =await prisma.doctor.findUnique({
        where:{userId:user.userId},
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    if(!isSameDay(payload.startDateTime,payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date Time And End Date Time Muar Be On The same Day")
    }

    if(isAfter(payload.startDateTime,payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date Time Cannot Be After End Date Time")
    }

    // চেক দিবো একই ডেটে user এর অন্য কোন শিডিউল আছে কিনা 
    // startOfDay date-fns npm প্যাকেজ থেকে আসতেছে
    const startOfTheDay=startOfDay(payload.startDateTime) //25August =>12:00 AM
    const startOfNextDay=addDays(startOfTheDay,1)//26 Augest =>12:00 Am
    // আজকের ডেট রাত 12 টা পর থেকে পরের দিন 12টা পর্যন্ত একই ডাক্তারে কাছে শিডিউল বুক দিতে পারবে না 
    const existingScheduleOnThisDate=await prisma.schedule.findFirst({
        where:{
            doctorId:doctor.id,
            isDeleted:false,
            startDateTime:{
                gte:startOfTheDay,
                lte:startOfNextDay
            }
        }
    })

    if(existingScheduleOnThisDate){
        throw new AppError(httpStatus.CONFLICT,"You Already Have A Schedule For This Date")
    }

    // প্রতিটা মিটিং এর সময় কতো মিনিট করে হবে সেটা বের করবো  
    const durationInMinutes=differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    )

    const MINITES_ALLOCATED_PER_SLOT=20

    const totalslots=Math.floor(durationInMinutes / MINITES_ALLOCATED_PER_SLOT)
    // schedul create 
    const schedule=await prisma.schedule.create({
        data:{
            startDateTime:payload.startDateTime,
            endDateTime:payload.endDateTime,
            meetingLink:payload.meetingLink,
            totalSlots: totalslots  ,
            availableslots:totalslots,
            doctorId:doctor.id
        },
        include:{
            doctor:{
                select:{
                    name:true,
                    email:true,
                    contactNumber:true
                }
            }
        }
    })

    return schedule

}


const getMySchedules=async(query:IPostQuery,user:RequestUser){

    // পেজিনেশন 
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const doctor=await prisma.doctor.findUnique({
        where:{userId:user.userId}
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    // let limit = 10;
    // if (query.limit) {
    //     limit = Number(query.limit);
    // }

    // let page = 1;
    // if (query.page) {
    //     page = Number(query.page);
    // }

    // const skip = (page - 1) * limit;


    
    const andConditions: ScheduleWhereInput[] = [
        {doctorId : doctor.id},{isDeleted : false}
    ];

    if (query.status) {
        andConditions.push({ status: query.status });
    }
    
    // schedules গুলো কে Get করতেছি 
    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },
        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include : {
            appointments : {
                include : {
                    patient : true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });
     return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}


const getAllSchedule=async(query:IPostQuery){
        // পেজিনেশন 
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"


    const andConditions: ScheduleWhereInput[] = [];

    if (query.doctorId) {
        andConditions.push({ doctorId: query.doctorId });
    }
    if (query.email) {
        andConditions.push({ doctor : {
            email : query.email
        } });
    }

    if (query.status) {
        andConditions.push({ status: query.status });
    }

    //Searching-----------------------------------------------------
	// যদি user কোনো searchTerm দেয়
  if (query.searchTerm) {
        andConditions.push({
            doctor: {
                OR: [
                    { name: { contains: query.searchTerm, mode: "insensitive" } },
                    { email: { contains: query.searchTerm, mode: "insensitive" } },
                    {
                        specialization: { contains: query.searchTerm, mode: "insensitive" },
                    },
                ],
            },
        });
    };
    
    const schedules = await prisma.schedule.findMany({
        where: {
            AND: andConditions
        },

        take: limit,
        skip,
        orderBy: {
            // sortBy : sortOrder
            [sortBy]: sortOrder
        },
        include: {
            appointments: {
                include: {
                    patient: true
                }
            }
        }
    })

    const total = await prisma.schedule.count({ where: { AND: andConditions } });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };




}

const getScheduleById=async(scheduleId:string)=>{
    const schedule=await prisma.schedule.findUnique({
        where:{id:scheduleId},
        include:{
            doctor:{
                select:{
                    id:true,
                    name:true,
                    email:true,
                    specialization:true,
                    userId:true
                }
            },
            appointments:{
                include:{
                    patient:true,
                    payment:true
                }
            }
        }
    })

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"schedule NOt Found")
    }

    return schedule
}

const updateSchedule = async (scheduleId : string, payload : IUpdateSchedulePayload, user : RequestUser) => {

    const doctor=await prisma.doctor.findUnique({
        where:{userId:user.userId}
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    const schedule=await prisma.schedule.findUnique({
        where:{id:scheduleId,doctorId:doctor?.id}
    })

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found")
    }

    if(schedule.status === Schedulestatus.PUBLISHED && schedule.totalSlots !== schedule.availableslots){
        throw new AppError(httpStatus.CONFLICT,"schedule Once Published cannot Be Updated")
    }


    // const updateData:IUpdateSchedulePayload ={}
    // if(payload.meetingLink){
    //     updateData.meetingLink = payload.meetingLink
    // }

    payload.meetingLink=payload.meetingLink || schedule.meetingLink
    payload.startDateTime=payload.startDateTime || schedule.startDateTime
    payload.endDateTime = payload.endDateTime || schedule.endDateTime

    if(!isSameDay(payload.startDateTime,payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date Time And End Date Time Muar Be On The same Day")
    }

    if(isAfter(payload.startDateTime,payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date Time Cannot Be After End Date Time")
    }

    //---------------নিচের সম্পন্ন কোড createSchedule থেকে copy করা ---------------

     // চেক দিবো একই ডেটে user এর অন্য কোন শিডিউল আছে কিনা 
    // startOfDay date-fns npm প্যাকেজ থেকে আসতেছে
    const startOfTheDay=startOfDay(payload.startDateTime) //25August =>12:00 AM
    const startOfNextDay=addDays(startOfTheDay,1)//26 Augest =>12:00 Am
    // আজকের ডেট রাত 12 টা পর থেকে পরের দিন 12টা পর্যন্ত একই ডাক্তারে কাছে শিডিউল বুক দিতে পারবে না 
    const existingScheduleOnThisDate=await prisma.schedule.findFirst({
        where:{
            doctorId:doctor.id,
            isDeleted:false,
            startDateTime:{
                gte:startOfTheDay,
                lte:startOfNextDay
            }
        }
    })

    if(existingScheduleOnThisDate){
        throw new AppError(httpStatus.CONFLICT,"You Already Have A Schedule For This Date")
    }

     // প্রতিটা মিটিং এর সময় কতো মিনিট করে হবে সেটা বের করবো  
    const durationInMinutes=differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    )

    const MINITES_ALLOCATED_PER_SLOT=20

    const totalslots=Math.floor(durationInMinutes / MINITES_ALLOCATED_PER_SLOT)
    // schedul create 
       const updatedSchedule=await prisma.schedule.update({
        where:{
            id:scheduleId
        },
        data:{
            startDateTime:payload.startDateTime,
            endDateTime:payload.endDateTime,
            meetingLink:payload.meetingLink,
            totalSlots: totalslots  ,
            availableslots:totalslots,
            doctorId:doctor.id
        },
        include:{
            doctor:{
                select:{
                    name:true,
                    email:true,
                    contactNumber:true
                }
            }
        }
    })

    return updatedSchedule
}

const publishSchedule=async(scheduleId:string,user:RequestUser)=>{
    const doctor=await prisma.doctor.findUnique({
        where:{userId:user.userId}
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    const schedule=await prisma.schedule.findUnique({
        where:{id:scheduleId,doctorId:doctor?.id}
    })

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found")
    }

    if(schedule.status === Schedulestatus.PUBLISHED){
        throw new AppError(httpStatus.CONFLICT,"Schedule Is Already Published")
    }

    const publishedSchedule=await prisma.schedule.update({
        where:{id:schedule.id},
        data:{status:Schedulestatus.PUBLISHED}
    })

    return publishedSchedule

}

const deleteSchedule=async(scheduleId:string,user:RequestUser)=>{
      const doctor=await prisma.doctor.findUnique({
        where:{userId:user.userId}
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    const schedule=await prisma.schedule.findUnique({
        where:{id:scheduleId,doctorId:doctor?.id}
    })

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found")
    }

     if(schedule.status === Schedulestatus.PUBLISHED && schedule.totalSlots !== schedule.availableslots){
        throw new AppError(httpStatus.CONFLICT,"schedule Once Published And Appointment Booked cannot Be Deleted")
    }

    const deletedSchedule=await prisma.schedule.update({
        where:{id:schedule.id},
        data:{isDeleted:true,deleteAt:new Date()}
    })

    return deletedSchedule

}

const getTodaysSchedul=async(query:IPostQuery)=>{

    if(!query.doctorId){
         throw new AppError(httpStatus.NOT_FOUND,"Doctor Id Must Be Provided In Query ")
    }

    const doctor=await prisma.doctor.findUnique({
        where:{id:query.doctorId}
    })

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found")
    }

    // পেজিনেশন 
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const now = new Date();
    const startOfToday = startOfDay(now);
    const startOfTomorrow = addDays(startOfToday, 1);

    const andConditions: ScheduleWhereInput[] = [
        {
            doctor:query.doctorId
        },
        { isDeleted: false },
        { status: Schedulestatus.PUBLISHED },
        {
            startDateTime: {
                gte: startOfToday,
                lt: startOfTomorrow,
                gt: now,
            },
        },
        {
            availableslots:{gt:0}
        }
    ];

    const schedules = await prisma.schedule.findMany({
        where: {
            AND: andConditions,
        },
        take: limit,
        skip,
        orderBy: {
            [sortBy]: sortOrder,
        },
        include: {
            appointments: {
                include: {
                    patient: true,
                },
            },
        },
    });

    const total = await prisma.schedule.count({
        where: { AND: andConditions },
    });

    return {
        data: schedules,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}


export const ScheduleServices={
    createSchedule,
    getMySchedules,
    getAllSchedule,
    getScheduleById,
    updateSchedule,
    publishSchedule,
    deleteSchedule,
    getTodaysSchedul
}