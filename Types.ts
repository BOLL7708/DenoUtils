export interface ILoggingProxy {
    v: (tag: string, message: string, ...extras: any[])=>void
    d: (tag: string, message: string, ...extras: any[])=>void
    i: (tag: string, message: string, ...extras: any[])=>void
    w: (tag: string, message: string, ...extras: any[])=>void
    e: (tag: string, message: string, ...extras: any[])=>void
}