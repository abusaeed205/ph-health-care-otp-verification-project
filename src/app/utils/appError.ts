// আমরা new Error throw করি বাট সেখানে কোন ‍Status code দেয় না । সেজন্য এই ফাংশন বানানো 

export class AppError extends Error{

    public statusCode:number

    // stack হলো Error কোন ফাইল থেকে আসছে তা দেখাবে 

    constructor(statusCode:number,message:string,stack=""){
        super(message) //throw new Error(message)

        this.statusCode=statusCode

        if(stack){
            this.stack=stack
        }else{
            Error.captureStackTrace(this,this.constructor)
        }
    }

}