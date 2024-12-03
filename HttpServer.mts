import {serveDir} from '@std/http/file-server'
import {ILoggingProxy} from './Types.mts'

export interface IHttpServerOptions {
    name: string
    port: number
    rootFolders: { [path: string]: string },
    loggingProxy: ILoggingProxy
}

export default class HttpServer {
    private readonly TAG: string
    private readonly _options: IHttpServerOptions
    private _server?: Deno.HttpServer

    constructor(options: IHttpServerOptions) {
        this._options = options
        this.TAG = `${this.constructor.name}->${this._options.name}`
        this.start()
    }

    private start() {
        const Log = this._options.loggingProxy
        // Turns out it was important here to not connect to `localhost` but the IP, or else Firefox would get a 2000ms initial lookup delay.
        this._server = Deno.serve(
            {hostname: '127.0.0.1', port: this._options.port},
            (request) => {
                const pathName = new URL(request.url).pathname
                const pair =
                    Object.entries(this._options.rootFolders)
                        .find(([key, value]) => {
                            return pathName.startsWith(key)
                        })
                const rootPath = pair && pair.length == 2 ? `${pair[1]}` : ''
                if (rootPath.length) {
                    return serveDir(request, {
                        fsRoot: rootPath
                    })
                } else {
                    Log.w(this.TAG, 'Unable to match path to static file store', request.url)
                }
                return new Response()
            }
        )
    }

    public async stop() {
        await this._server?.shutdown()
    }
}
