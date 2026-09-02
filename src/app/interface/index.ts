//এখানে Common interface গুলো রাখা হয়েছে যেমন Search ,filtering, shorting , pagination etc . এগুলো আমাদের সকল জায়গায় লাগে তাই এখানে  রাখছি 

export interface IPostQuery{
    searchTerm?: string
    page?: string
    limit?: string
    sortOrder?: string
    sortBy?: string

    //any other filter fields can be added here
    [key:string]:any
} 