import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailler";
import { prisma } from "./app/lib/prisma";
import { redisclient } from "./app/lib/redis";
import { seedSuperAdmin, seedTesterAdmin, seedTesterDoctor } from "./app/utils/seed";

const PORT = config.port;

const main = async () => {
	try {
		await prisma.$connect(); // database url
		await redisclient.connect() //OTP store env url
		console.log("Redis connected Successfully")
		console.log("Connected to the database successfully.");
		await transporter.verify() // Email OTP Send 
		console.log("Nodemailer Connected Successfully")
		await seedSuperAdmin() // middlewate
		// await seedTesterAdmin();
		// await seedTesterDoctor();


		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
