import { createClient } from 'redis';
import config from '../config';

// copy for redis SDK clients (website)v password forget OTP

export const redisclient = createClient({
    username: config.redis_user,
    password: config.redis_password,
    socket: {
        host: config.redis_host,
        port: Number(config.redis_port)
    }
});