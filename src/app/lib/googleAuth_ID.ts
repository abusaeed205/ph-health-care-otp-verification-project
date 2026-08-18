import { OAuth2Client } from "google-auth-library";
import config from "../config";

// এখানে Google_Client_ID Import করা হচ্ছে
export const googleclient = new OAuth2Client({
	client_id: config.google_client_id,
});
