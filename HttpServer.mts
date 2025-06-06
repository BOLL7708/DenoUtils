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
    simpleApi: IHttpServerStaticApi
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
    [path: string]: any | (() => any) | ((request: Request) => any)
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

    applyCorsHeaders(handler: (req: Request) => Response | Promise<Response>) {
        return async (req: Request): Promise<Response> => {
            const origin = req.headers.get('Origin') ?? '*' // Use * if no origin present
            const res = await handler(req)
            const headers = new Headers(res.headers)
            headers.set('Access-Control-Allow-Origin', origin)
            headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            headers.set('Access-Control-Allow-Credentials', 'true')
            return new Response(res.body, {
                status: res.status,
                statusText: res.statusText,
                headers
            })
        }
    }

    private start() {
        const Log = this._options.loggingProxy
        this._server = Deno.serve(
            { hostname: this._options.hostname, port: this._options.port },
            this.applyCorsHeaders((request) => {
                // Preflight response
                if (request.method === "OPTIONS") {
                    return new Response(null, { status: 204 });
                }

                const pathName = new URL(request.url).pathname

                // Handle API endpoints
                const apiPaths: { [fullPath: string]: string } = Object.fromEntries(
                    Object.entries(this._options.simpleApi.responses).map(
                        ([path, _value]) => [`/${this._options.simpleApi.root}/${path}`, path]
                    )
                )
                if (pathName.startsWith(`/${this._options.simpleApi.root}/`)) {
                    if (Object.keys(apiPaths).includes(pathName)) {
                        const path = apiPaths[pathName]
                        let data = this._options.simpleApi.responses[path]
                        if (typeof data === 'function') {
                            data = data(request)
                        }
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
                        fsRoot: rootPath,
                        headers: []
                    })
                } else {
                    Log.w(this.TAG, 'Unable to match path to static file store', request.url)
                }

                // Empty response for unmatched paths
                return new Response()
            })
        )
    }

    public async stop() {
        await this._server?.shutdown()
    }
}
