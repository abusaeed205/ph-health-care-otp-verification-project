import { error } from "node:console"
import { cloudinary } from "../../lib/cloudinary"
import { prisma } from "../../lib/prisma"
import { UploadApiResponse } from "cloudinary"



const uploadProfileImage=async(buffer:Buffer , userId:string)=>{
   
// 01/02.....আগের ID ধারী user এর profile image খুজো
    const currentUser=await prisma.user.findUnique({
        where:{
            id:userId
        },
        select:{
            imagepublicId:true,
            image:true
        }
    })

// ============================================
// STEP 1: Upload image to Cloudinary
// ============================================

const cloudinaryResult=await new Promise<UploadApiResponse>((resolve,reject)=>{

    cloudinary.uploader.upload_stream({
    resource_type:"auto"
   },
   async (error,result)=>{
    if(error){
        return reject(error)
    }

    if(!result){
        return reject(new Error ("No result returned from cloudinary"))
    }

    resolve(result)
    
   }
).end(buffer)

})


// ============================================
// STEP 2: Update user's image information
// ============================================
  

const updatedUser=await prisma.user.update({
        where:{
            id:userId
        },
        data:{
            image:cloudinaryResult?.secure_url,
            imagepublicId:cloudinaryResult?.public_id
        },
           // omit মানে হলো database থেকে data আনার সময় নির্দিষ্ট field বাদ দেওয়া।
    omit:{
        password:true
    }
})
console.log(updatedUser)

// 02/02.....আগের profile image যদি থাকে সেটা ডিলেট করো 
if(currentUser?.imagepublicId && currentUser.image){
    await cloudinary.uploader.destroy(currentUser.imagepublicId)
}


// return result
return updatedUser

}


export const UserServices={
    uploadProfileImage
}