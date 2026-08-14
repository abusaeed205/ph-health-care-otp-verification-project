import config from "../config";
import { v2 as cloudinary } from "cloudinary";

//(Copy) https://medium.com/@jatinumamtora/uploading-images-directly-to-cloudinary-from-a-form-in-node-js-6f3a087481b0

// Configure Cloudinary (use your own cloud_name, api_key, and api_secret)
cloudinary.config({
  cloud_name:config.cloudinary_cloud_name,
  api_key: config.cloudinary_api_key,
  api_secret:config.cloudinary_api_secret
});

export const cloudinaryUpload=cloudinary