import nodemailer from "nodemailer";
import config from "../config";

// (COPY from)Nodemailer Documentation > Guides > Using Gmail
// এখান থেকে আমরা transporter server.ts এর সাথে কানেক্ট করবো 
export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: config.smtp_user,
    pass: config.smtp_password,
  },
});