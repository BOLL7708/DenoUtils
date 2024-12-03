import Log from './Log.mts'

export interface IWebSocketServerOptions {
    name: string
    port: number
    keepAlive: boolean
    onServerEvent: TWebSocketServerEventCallback
    onMessageReceived: TWebSocketServerMessageCallback
}

export interface IWebSocketSessions {
    [uuid: string]: {
        socket: WebSocket,
        subProtocols: string[]
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
        if (this._server) await this._server.shutdown()
        try {
            this._server = Deno.serve({
                port: this._options.port,
                handler: (req) => {
                    let sessionId: string = ''
                    const upgrade = req.headers.get('upgrade')
                    if (upgrade != 'websocket') {
                        Log.w(this.TAG, 'Connection failed to upgrade', {upgrade})
                        return new Response(null, {status: 501})
                    }

                    const subProtocols = (req.headers.get('sec-websocket-protocol') ?? '')
                        .split(',')
                        .map(it => it.trim())
                        .filter(it => it.length)
                    Log.d(this.TAG, 'Client Protocols', subProtocols)

                    const {socket, response} = Deno.upgradeWebSocket(req)
                    Log.v(this.TAG, 'Connection was upgraded', {upgrade, subProtocols})

                    socket.onopen = (open) => {
                        sessionId = crypto.randomUUID()
                        this._sessions[sessionId] = {socket, subProtocols}
                        this._options.onServerEvent(EWebSocketServerState.ClientConnected, undefined, {
                            sessionId,
                            subProtocols
                        })
                        Log.i(this.TAG, 'Client connected, session registered', {
                            sessionId,
                            subProtocols,
                            type: open.type
                        })
                    }
                    socket.onclose = (close) => {
                        delete this._sessions[sessionId]
                        this._options.onServerEvent(EWebSocketServerState.ClientDisconnected, undefined, {
                            sessionId,
                            subProtocols
                        })
                        Log.i(this.TAG, 'Client disconnected, session removed', {
                            sessionId,
                            subProtocols,
                            type: close.type,
                            code: close.code
                        })
                    }
                    socket.onerror = (error) => {
                        this._options.onServerEvent(EWebSocketServerState.Error, error.type, {sessionId, subProtocols})
                        Log.e(this.TAG, `Server error`, {sessionId, subProtocols, type: error.type})
                    }
                    socket.onmessage = (message) => {
                        this._options.onMessageReceived(message.data, {sessionId, subProtocols})
                        Log.v(this.TAG, 'Message received', {
                            sessionId,
                            subProtocols,
                            type: message.type,
                            message: message.data
                        })
                    }
                    return response
                }
            })
            this._server.finished.then(() => {
                if (!this._shouldShutDown) {
                    this._options.onServerEvent(EWebSocketServerState.Error, 'Server finished unexpectedly')
                    Log.w(this.TAG, 'Server finished unexpectedly')
                    if (this._options.keepAlive) this.restart()
                }
            })
        } catch (e) {
            this._options.onServerEvent(EWebSocketServerState.Error, `${e}`)
            Log.e(this.TAG, 'Unable to start server', {port: this._options.port, error: e})
        }
    }

    async restart() {
        this._shouldShutDown = false
        Log.i(this.TAG, 'Restarting server', {port: this._options.port})
        await this.start()
        this._options.onServerEvent(EWebSocketServerState.ServerStarted)
    }

    async shutdown() {
        this._shouldShutDown = true
        Log.i(this.TAG, 'Shutting down server', {port: this._options.port})
        await this._server?.shutdown()
        this._options.onServerEvent(EWebSocketServerState.ServerShutdown)
    }

    // endregion

    // region Sending
    private _unreadyStates: number[] = [WebSocket.CONNECTING, WebSocket.CLOSING, WebSocket.CLOSED]

    sendMessage(message: string, toSessionId: string, withSubProtocol?: string): boolean {
        const session = this._sessions[toSessionId]
        if (
            session && !this._unreadyStates.includes(session.socket.readyState)
            && (withSubProtocol === undefined || session.subProtocols[0] === withSubProtocol )
        ) {
            session.socket.send(message)
            Log.v(this.TAG, 'Sent message', {toSessionId, message})
            return true
        }
        return false
    }

    sendMessageToAll(message: string, subProtocol?: string): number {
        let sent = 0
        for (const sessionId of Object.keys(this._sessions)) {
            if (this.sendMessage(message, sessionId, subProtocol)) sent++
        }
        Log.v(this.TAG, 'Message sent to all', {sent, message})
        return sent
    }

    sendMessageToOthers(message: string, mySessionId: string, subProtocol?: string): number {
        let sent = 0
        for (const sessionId of Object.keys(this._sessions)) {
            if (sessionId != mySessionId) {
                if (this.sendMessage(message, sessionId, subProtocol)) sent++
            }
        }
        Log.v(this.TAG, 'Message sent to others', {sent, message, mySessionId})
        return sent
    }

    sendMessageToGroup(message: string, toSessionIds: string[], subProtocol?: string): number {
        let sent = 0
        for (const sessionId of toSessionIds) {
            if (this.sendMessage(message, sessionId, subProtocol)) sent++
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

export interface IWebSocketServerSession {
    sessionId: string
    subProtocols: string[]
}

// endregion
