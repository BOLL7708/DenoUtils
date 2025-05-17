import { serveDir } from '@std/http/file-server'
import { ILoggingProxy } from './Types.mts'

export interface IHttpServerOptions {
    name: string
    port: number
    /**
     * Beware, using `localhost` can introduce a 2000ms delay for Firefox connections, use the IP instead: `127.0.0.1`.
     */
    hostname: string
    rootFolders: IHttpServerRootFolders
    staticApi: IHttpServerStaticApi
    loggingProxy: ILoggingProxy
}

export interface IHttpServerRootFolders {
    [path: string]: string
}

export interface IHttpServerStaticApi {
    /** Without slashes as those are added in */
    root: string
    responses: IHttpServerStaticApiResponse
}

export interface IHttpServerStaticApiResponse {
    [path: string]: any
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
        //
        this._server = Deno.serve(
            { hostname: this._options.hostname, port: this._options.port },
            (request) => {
                const pathName = new URL(request.url).pathname
                const apiPaths: { [fullPath: string]: string } = Object.fromEntries(
                    Object.entries(this._options.staticApi.responses).map(
                        ([path, _value]) => [`/${this._options.staticApi.root}/${path}`, path]
                    )
                )
                // Handle API endpoints
                if (pathName.startsWith(`/${this._options.staticApi.root}/`)) {
                    if (Object.keys(apiPaths).includes(pathName)) {
                        const path = apiPaths[pathName]
                        const data = this._options.staticApi.responses[path]
                        return new Response(JSON.stringify(data), {
                            headers: { 'Content-Type': 'application/json' }
                        })
                    }
                    return new Response('', { status: 404 })
                }

                // Handle static files
                const pair = Object.entries(this._options.rootFolders)
                    .find(([key, _]) => {
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
