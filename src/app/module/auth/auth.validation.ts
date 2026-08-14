import z from "zod";
 // এগুলো auth router এ ব্যবহার করা হচ্ছে
const patentZodSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.email(),
  password: z.string().min(8).max(20).regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter' })
  .regex(/[0-9]/, { message: 'Password must contain at least one number' })
  .regex(/[^A-Za-z0-9]/, { message: 'Password must contain at least one special character' }),
  patient:z.object({
    contactNumber: z.string().optional(),
    age:z.number()
  }).optional()
});

const forgetPasswordZodSchema = z.object({
  email: z.email(),
})

 // এগুলো auth router এ ব্যবহার করা হচ্ছে
const resetPasswordZodSchema = z.object({
  email: z.email(),
  newPassword: z.string()
    .min(8, "Password Must Minimum 8 Characters Long.")
    .regex(/[a-z]/, "Password must contain atleast 1 Lowercase Letter")
    .regex(/[A-Z]/, "Password must contain atleast 1 Uppercase Letter")
    
    .regex(/[0-9]/, "Password must contain atleast 1 Number")
    .regex(/[^A-Za-z0-9]/, "Password must contain atleast 1 Special Character"),
  otp : z.string().length(6)
})

  // এগুলো auth router এ ব্যবহার করা হচ্ছে
export const ZodUserValidation ={
    patentZodSchema,
    forgetPasswordZodSchema,
    resetPasswordZodSchema
}