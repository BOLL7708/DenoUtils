import {ILoggingProxy} from './Types.mts'

export interface IWebSocketServerOptions {
    name: string
    port: number
    hostname: string
    keepAlive: boolean
    onServerEvent: TWebSocketServerEventCallback
    onMessageReceived: TWebSocketServerMessageCallback,
    loggingProxy: ILoggingProxy
}

export interface IWebSocketSessions {
    [uuid: string]: {
        socket: WebSocket,
        subprotocols: string[]
    }
}

export default class WebSocketServer {
    private readonly TAG: string
    private readonly _options: IWebSocketServerOptions
    private _server?: Deno.HttpServer
    private _sessions: IWebSocketSessions = {}
    private _shouldShutDown: boolean = false

    constructor(options: IWebSocketServerOptions) {
        this._options = options
        this.TAG = `${this.constructor.name}->${this._options.name}`
        this.start().then()
    }

    // region Lifecycle
    private async start() {
        const Log = this._options.loggingProxy
        if (this._server) await this._server.shutdown()
        try {
            this._server = Deno.serve({
                port: this._options.port,
                hostname: this._options.hostname,
                handler: (req) => {
                    const secWebsocketProtocol = req.headers.get('sec-websocket-protocol') ?? ''
                    const subprotocols = secWebsocketProtocol
                        .split(',')
                        .map(it => it.trim())
                        .filter(it => it.length)

                    Log.d(this.TAG, 'Client Protocols', subprotocols)
                    const upgrade = req.headers.get('upgrade')

                    if (upgrade != 'websocket') {
                        Log.w(this.TAG, 'Connection failed to upgrade', {upgrade})
                        return new Response(null, {status: 501})
                    }
                    try {
                        const {socket, response} = Deno.upgradeWebSocket(req, {
                            protocol: subprotocols[0] // This is required by Chrome (but not Firefox), else it will immediately disconnect with code 1006 and no specified reason.
                        })

                        Log.v(this.TAG, 'Connection was upgraded', {upgrade, subprotocols})

                        let sessionId: string = ''
                        socket.onopen = (open) => {
                            sessionId = crypto.randomUUID()
                            this._sessions[sessionId] = {socket, subprotocols: subprotocols}
                            this._options.onServerEvent(EWebSocketServerState.ClientConnected, undefined, {
                                sessionId,
                                subprotocols
                            })
                            Log.i(this.TAG, 'Client connected, session registered', {
                                sessionId,
                                subprotocols,
                                type: open.type
                            })
                        }
                        socket.onclose = (close) => {
                            delete this._sessions[sessionId]
                            this._options.onServerEvent(EWebSocketServerState.ClientDisconnected, undefined, {
                                sessionId,
                                subprotocols
                            })
                            Log.i(this.TAG, 'Client disconnected, session removed', {
                                sessionId,
                                subprotocols,
                                type: close.type,
                                code: close.code
                            })
                        }
                        socket.onerror = (error) => {
                            this._options.onServerEvent(EWebSocketServerState.Error, error.type, {
                                sessionId,
                                subprotocols
                            })
                            Log.e(this.TAG, `Server error`, {
                                sessionId,
                                subprotocols,
                                type: error.type,
                                message: (error as ErrorEvent).message ?? undefined,
                                debug: error
                            })
                        }
                        socket.onmessage = (message) => {
                            this._options.onMessageReceived(message.data, {sessionId, subprotocols: subprotocols})
                            Log.v(this.TAG, 'Message received', {
                                sessionId,
                                subprotocols,
                                type: message.type,
                                message: message.data
                            })
                        }
                        return response
                    } catch (e: unknown) {
                        Log.w(this.TAG, 'Connection failed to upgrade', `${e}`)
                        return new Response(null, {status: 500})
                    }
                }
            })
            this._server.finished.then(() => {
                if (!this._shouldShutDown) {
                    this._options.onServerEvent(EWebSocketServerState.Error, 'Server finished unexpectedly')
                    Log.w(this.TAG, 'Server finished unexpectedly')
                    if (this._options.keepAlive) this.restart()
                }
            })
        } catch (e: unknown) {
            this._options.onServerEvent(EWebSocketServerState.Error, `${e}`)
            Log.e(this.TAG, 'Unable to start server', {port: this._options.port, error: e})
        }
    }

    async restart() {
        const Log = this._options.loggingProxy
        this._shouldShutDown = false
        Log.i(this.TAG, 'Restarting server', {port: this._options.port})
        await this.start()
        this._options.onServerEvent(EWebSocketServerState.ServerStarted)
    }

    async shutdown() {
        const Log = this._options.loggingProxy
        this._shouldShutDown = true
        Log.i(this.TAG, 'Shutting down server', {port: this._options.port})
        await this._server?.shutdown()
        this._options.onServerEvent(EWebSocketServerState.ServerShutdown)
    }

    // endregion

    // region Sending
    private _unreadyStates: number[] = [WebSocket.CONNECTING, WebSocket.CLOSING, WebSocket.CLOSED]

    sendMessage(message: string, toSessionId: string, withSubprotocols?: TWebSocketServerSessionSubprotocols): boolean {
        const Log = this._options.loggingProxy
        const session = this._sessions[toSessionId]
        const checkSubprotocols = (): boolean => {
            if (withSubprotocols === undefined) return true
            for (let i = 0; i < withSubprotocols.length; i++) {
                const matchValue = withSubprotocols[i]
                const sessionValue = session.subprotocols[i]
                if (matchValue !== undefined && matchValue !== sessionValue) return false
            }
            return true
        }
        if (
            session
            && !this._unreadyStates.includes(session.socket.readyState)
            && checkSubprotocols()
        ) {
            session.socket.send(message)
            Log.v(this.TAG, 'Sent message', {toSessionId, message})
            return true
        }
        return false
    }

    sendMessageToAll(message: string, subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this._options.loggingProxy
        let sent = 0
        for (const sessionId of Object.keys(this._sessions)) {
            if (this.sendMessage(message, sessionId, subprotocols)) sent++
        }
        Log.v(this.TAG, 'Message sent to all', {sent, message})
        return sent
    }

    sendMessageToOthers(message: string, mySessionId: string, subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this._options.loggingProxy
        let sent = 0
        for (const sessionId of Object.keys(this._sessions)) {
            if (sessionId != mySessionId) {
                if (this.sendMessage(message, sessionId, subprotocols)) sent++
            }
        }
        Log.v(this.TAG, 'Message sent to others', {sent, message, mySessionId})
        return sent
    }

    sendMessageToGroup(message: string, toSessionIds: string[], subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this._options.loggingProxy
        let sent = 0
        for (const sessionId of toSessionIds) {
            if (this.sendMessage(message, sessionId, subprotocols)) sent++
        }
        Log.v(this.TAG, 'Message sent to group', {sent, message, sessionIds: toSessionIds})
        return sent
    }

    /**
     * Will always succeed, returns false if there is no session to close.
     * @param sessionId
     * @param code
     * @param reason
     */
    disconnectSession(sessionId: string, code?: number, reason?: string): boolean {
        const Log = this._options.loggingProxy
        const session = this._sessions[sessionId]
        if (session.socket) {
            session.socket.close(code, reason)
            delete this._sessions[sessionId]
            return true
        }
        return false
    }

    // endregion
}

// region Types
export enum EWebSocketServerState {
    ServerStarted,
    ServerShutdown,
    ClientConnected,
    ClientDisconnected,
    Error,
}

export type TWebSocketServerEventValue = string | number | undefined
export type TWebSocketServerEventCallback = (state: EWebSocketServerState, value?: TWebSocketServerEventValue, session?: IWebSocketServerSession) => void
export type TWebSocketServerMessageCallback = (message: string, session: IWebSocketServerSession) => void
export type TWebSocketServerSessionSubprotocols = (string | undefined)[]

export interface IWebSocketServerSession {
    sessionId: string
    subprotocols: string[]
}

// endregion
