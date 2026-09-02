import cron from "node-cron";
import { prisma } from "./prisma";
import { DoctorVerificationStatus, Role } from "../../generated/prisma/enums";

// Unverified doctor delete করার cron function
export const deleteUnverifiedDoctor = async () => {
	// প্রতি 10 মিনিট পরপর এই cron job চলবে
	cron.schedule(" */10 * * * *", async () => {
		//   prisma business => doctors deletes
		try {
			// বর্তমান সময় থেকে 1 ঘণ্টা আগের সময় বের করা হচ্ছে
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
			const deletedDoctors = await prisma.user.deleteMany({
				 // শর্ত পূরণ করা Doctor User-গুলো delete করা হবে
				where: {
					role: Role.DOCTOR, // User-এর role অবশ্যই DOCTOR হতে হবে
					emailVerified: false,
					createdAt: { lt: oneHourAgo }, // Account তৈরি হওয়ার সময় 1 ঘণ্টার বেশি পুরোনো হতে হবে
					doctor: { // Doctor-এর verification status PENDING হতে হবে
						verificationStatus: DoctorVerificationStatus.PANDING,
					},
				},
			});

			 // যদি কোনো Doctor delete হয়ে থাকে
			if (deletedDoctors.count > 0) {
				console.log(`
        cron:Deleted ${deletedDoctors.count}unverified email doctor applications older than 1 hour
        `);
        
			}
		} catch (error) {
			console.log("cron:Failed to delete unverified deoctor application:",error);
		}

        console.log("Doctor Delete cron schedule(every 10 minutes)")
	});
};
