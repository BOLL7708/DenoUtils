import {ILoggingProxy} from './Types.ts'

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
    readonly #tag: string
    readonly #options: IWebSocketServerOptions
    #server?: Deno.HttpServer
    #sessions: IWebSocketSessions = {}
    #shouldShutDown: boolean = false

    constructor(options: IWebSocketServerOptions) {
        this.#options = options
        this.#tag = `${this.constructor.name}->${this.#options.name}`
        this.#start().then()
    }

    // region Lifecycle
    async #start() {
        const Log = this.#options.loggingProxy
        if (this.#server) await this.#server.shutdown()
        try {
            this.#server = Deno.serve({
                port: this.#options.port,
                hostname: this.#options.hostname,
                handler: (req) => {
                    const secWebsocketProtocol = req.headers.get('sec-websocket-protocol') ?? ''
                    const subprotocols = secWebsocketProtocol
                        .split(',')
                        .map(it => it.trim())
                        .filter(it => it.length)

                    Log.d(this.#tag, 'Client Protocols', subprotocols)
                    const upgrade = req.headers.get('upgrade')

                    if (upgrade != 'websocket') {
                        Log.w(this.#tag, 'Connection failed to upgrade', {upgrade})
                        return new Response(null, {status: 501})
                    }
                    try {
                        const {socket, response} = Deno.upgradeWebSocket(req, {
                            protocol: subprotocols[0] // This is required by Chrome (but not Firefox), else it will immediately disconnect with code 1006 and no specified reason.
                        })

                        Log.v(this.#tag, 'Connection was upgraded', {upgrade, subprotocols})

                        let sessionId: string = ''
                        socket.onopen = (open) => {
                            sessionId = crypto.randomUUID()
                            this.#sessions[sessionId] = {socket, subprotocols: subprotocols}
                            this.#options.onServerEvent(EWebSocketServerState.ClientConnected, undefined, {
                                sessionId,
                                subprotocols
                            })
                            Log.i(this.#tag, 'Client connected, session registered', {
                                sessionId,
                                subprotocols,
                                type: open.type
                            })
                        }
                        socket.onclose = (close) => {
                            delete this.#sessions[sessionId]
                            this.#options.onServerEvent(EWebSocketServerState.ClientDisconnected, undefined, {
                                sessionId,
                                subprotocols
                            })
                            Log.i(this.#tag, 'Client disconnected, session removed', {
                                sessionId,
                                subprotocols,
                                type: close.type,
                                code: close.code
                            })
                        }
                        socket.onerror = (error) => {
                            this.#options.onServerEvent(EWebSocketServerState.Error, error.type, {
                                sessionId,
                                subprotocols
                            })
                            Log.e(this.#tag, `Server error`, {
                                sessionId,
                                subprotocols,
                                type: error.type,
                                message: (error as ErrorEvent).message ?? undefined,
                                debug: error
                            })
                        }
                        socket.onmessage = (message) => {
                            this.#options.onMessageReceived(message.data, {sessionId, subprotocols: subprotocols})
                            Log.v(this.#tag, 'Message received', {
                                sessionId,
                                subprotocols,
                                type: message.type,
                                message: message.data
                            })
                        }
                        return response
                    } catch (e: unknown) {
                        Log.w(this.#tag, 'Connection failed to upgrade', `${e}`)
                        return new Response(null, {status: 500})
                    }
                }
            })
            this.#server.finished.then(() => {
                if (!this.#shouldShutDown) {
                    this.#options.onServerEvent(EWebSocketServerState.Error, 'Server finished unexpectedly')
                    Log.w(this.#tag, 'Server finished unexpectedly')
                    if (this.#options.keepAlive) this.restart()
                }
            })
        } catch (e: unknown) {
            this.#options.onServerEvent(EWebSocketServerState.Error, `${e}`)
            Log.e(this.#tag, 'Unable to start server', {port: this.#options.port, error: e})
        }
    }

    async restart() {
        const Log = this.#options.loggingProxy
        this.#shouldShutDown = false
        Log.i(this.#tag, 'Restarting server', {port: this.#options.port})
        await this.#start()
        this.#options.onServerEvent(EWebSocketServerState.ServerStarted)
    }

    async shutdown() {
        const Log = this.#options.loggingProxy
        this.#shouldShutDown = true
        Log.i(this.#tag, 'Shutting down server', {port: this.#options.port})
        await this.#server?.shutdown()
        this.#options.onServerEvent(EWebSocketServerState.ServerShutdown)
    }

    // endregion

    // region Sending
    #unreadyStates: number[] = [WebSocket.CONNECTING, WebSocket.CLOSING, WebSocket.CLOSED]

    sendMessage(message: string, toSessionId: string, withSubprotocols?: TWebSocketServerSessionSubprotocols): boolean {
        const Log = this.#options.loggingProxy
        const session = this.#sessions[toSessionId]
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
            && !this.#unreadyStates.includes(session.socket.readyState)
            && checkSubprotocols()
        ) {
            session.socket.send(message)
            Log.v(this.#tag, 'Sent message', {toSessionId, message})
            return true
        }
        return false
    }

    sendMessageToAll(message: string, subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this.#options.loggingProxy
        let sent = 0
        for (const sessionId of Object.keys(this.#sessions)) {
            if (this.sendMessage(message, sessionId, subprotocols)) sent++
        }
        Log.v(this.#tag, 'Message sent to all', {sent, message})
        return sent
    }

    sendMessageToOthers(message: string, mySessionId: string, subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this.#options.loggingProxy
        let sent = 0
        for (const sessionId of Object.keys(this.#sessions)) {
            if (sessionId != mySessionId) {
                if (this.sendMessage(message, sessionId, subprotocols)) sent++
            }
        }
        Log.v(this.#tag, 'Message sent to others', {sent, message, mySessionId})
        return sent
    }

    sendMessageToGroup(message: string, toSessionIds: string[], subprotocols?: TWebSocketServerSessionSubprotocols): number {
        const Log = this.#options.loggingProxy
        let sent = 0
        for (const sessionId of toSessionIds) {
            if (this.sendMessage(message, sessionId, subprotocols)) sent++
        }
        Log.v(this.#tag, 'Message sent to group', {sent, message, sessionIds: toSessionIds})
        return sent
    }

    /**
     * Will always succeed, returns false if there is no session to close.
     * @param sessionId
     * @param code
     * @param reason
     */
    disconnectSession(sessionId: string, code?: number, reason?: string): boolean {
        const Log = this.#options.loggingProxy
        const session = this.#sessions[sessionId]
        if (session.socket) {
            session.socket.close(code, reason)
            delete this.#sessions[sessionId]
            Log.v(this.#tag, 'Session disconnected', {sessionId, code, reason})
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
